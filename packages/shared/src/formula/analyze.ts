import { FORMULA_RESULT_TYPES, type FormulaResultType } from './constants';
import { FormulaSyntaxError, positionText } from './lexer';
import { parseFormulaCached, walkFormula, type FormulaNode } from './parser';
import { storedRefId } from './refs';

/**
 * Fórmulas — tipos.
 *
 * Cada pieza de la fórmula tiene un TIPO (número, texto, sí/no, fecha, fecha
 * y hora) y, si es un número, una UNIDAD (moneda, porcentaje, duración). Con
 * eso se infiere cómo mostrar el resultado sin que nadie lo elija: `{Precio}
 * * {Cantidad}` es moneda porque Precio lo es; `DIAS_ENTRE(…)` es un número.
 */

export type FormulaKind = 'number' | 'text' | 'boolean' | 'date' | 'datetime';


export const FORMULA_RESULT_LABELS: Record<FormulaResultType, string> = {
    number: 'Número',
    currency: 'Moneda',
    percent: 'Porcentaje',
    duration: 'Duración',
    text: 'Texto',
    date: 'Fecha',
    datetime: 'Fecha y hora',
    checkbox: 'Sí / No',
};

export type FormulaUnit =
    | { kind: 'currency'; currency: string; precision?: number }
    | { kind: 'percent'; precision?: number }
    | { kind: 'duration' }
    | null;

export interface FormulaTypeInfo {
    kind: FormulaKind;
    unit?: FormulaUnit;
    /** Varios valores (un lookup, una selección múltiple). */
    list?: boolean;
}

/** Lo mínimo de un campo para tipar sus referencias. */
export interface FormulaTypingField {
    id: number;
    type: string;
    label?: string;
    config?: Record<string, unknown> | null;
}

/** Tipo del campo del otro lado de un lookup/rollup (si se conoce). */
export type ThroughTargetOf = (fieldId: number) => { type: string; config?: Record<string, unknown> | null } | null | undefined;

/** Tipos que una fórmula NO puede usar (y por qué). */
export function formulaRefNotAllowed(type: string): string | null {
    if (type === 'relation') return 'Una relación no se puede usar en una fórmula: usa un lookup o un rollup de esa relación.';
    if (type === 'file') return 'Un campo de archivos no se puede usar en una fórmula.';
    if (type === 'button') return 'Un botón no tiene valor: no se puede usar en una fórmula.';
    return null;
}

function cfgOf(f: { config?: Record<string, unknown> | null }): Record<string, unknown> {
    return (f.config ?? {}) as Record<string, unknown>;
}

function numberUnitOf(type: string, config: Record<string, unknown>): FormulaUnit {
    if (type === 'currency') {
        const currency = typeof config.currency === 'string' ? config.currency : 'USD';
        const precision = typeof config.precision === 'number' ? config.precision : undefined;
        return { kind: 'currency', currency, ...(precision !== undefined ? { precision } : {}) };
    }
    if (type === 'percent') {
        const precision = typeof config.precision === 'number' ? config.precision : undefined;
        return { kind: 'percent', ...(precision !== undefined ? { precision } : {}) };
    }
    if (type === 'duration' || type === 'time_tracked') return { kind: 'duration' };
    return null;
}

/** Tipo de un valor de un campo "de datos" (no fórmula), por su tipo. */
export function kindOfFieldType(type: string, config: Record<string, unknown> = {}): FormulaTypeInfo {
    switch (type) {
        case 'number':
        case 'rating':
            return { kind: 'number' };
        case 'currency':
        case 'percent':
        case 'duration':
        case 'time_tracked':
            return { kind: 'number', unit: numberUnitOf(type, config) };
        case 'checkbox':
            return { kind: 'boolean' };
        case 'date':
            return { kind: 'date' };
        case 'datetime':
        case 'created_at':
        case 'updated_at':
            return { kind: 'datetime' };
        case 'multi_select':
            return { kind: 'text', list: true };
        case 'computed': {
            const op = String(config.operation ?? '');
            return op === 'concat' ? { kind: 'text' } : { kind: 'number' };
        }
        default:
            // text, long_text, email, url, phone, select, user, created_by,
            // updated_by, autonumber, ai…
            return { kind: 'text' };
    }
}

/**
 * Tipo de la referencia a un campo. Una fórmula toma el tipo de SU resultado
 * (elegido o inferido); un lookup el del campo traído (como lista); un rollup
 * el de su operación.
 */
export function kindOfField(
    field: FormulaTypingField,
    ctx: { fields: ReadonlyMap<number, FormulaTypingField>; throughTarget?: ThroughTargetOf; visiting?: Set<number> },
): FormulaTypeInfo {
    const config = cfgOf(field);
    if (field.type === 'formula') {
        const visiting = ctx.visiting ?? new Set<number>();
        if (visiting.has(field.id)) return { kind: 'text' };
        visiting.add(field.id);
        try {
            // Con la moneda/decimales EFECTIVOS (los elegidos o los inferidos
            // de sus propios campos): «{Total} / 3» es moneda en la de Total.
            const shown = formulaDisplayConfig(field, { ...ctx, visiting });
            return resultTypeInfo(shown.type, shown.config);
        } finally {
            visiting.delete(field.id);
        }
    }
    if (field.type === 'lookup') {
        const t = ctx.throughTarget?.(field.id);
        const inner = t ? kindOfFieldType(t.type, cfgOf(t)) : { kind: 'text' as const };
        return { ...inner, list: true };
    }
    if (field.type === 'rollup') {
        const op = String(config.operation ?? 'count');
        if (op === 'count') return { kind: 'number' };
        const t = ctx.throughTarget?.(field.id);
        if (t && (t.type === 'date' || t.type === 'datetime') && (op === 'min' || op === 'max')) {
            return { kind: t.type === 'date' ? 'date' : 'datetime' };
        }
        if (t && op !== 'avg') return { kind: 'number', unit: numberUnitOf(t.type, cfgOf(t)) };
        if (t && op === 'avg' && (t.type === 'currency' || t.type === 'percent' || t.type === 'duration')) {
            return { kind: 'number', unit: numberUnitOf(t.type, cfgOf(t)) };
        }
        return { kind: 'number' };
    }
    return kindOfFieldType(field.type, config);
}

function resultTypeInfo(rt: FormulaResultType, config: Record<string, unknown>): FormulaTypeInfo {
    switch (rt) {
        case 'currency':
            return {
                kind: 'number',
                unit: {
                    kind: 'currency',
                    currency: typeof config.currency === 'string' ? config.currency : 'USD',
                    ...(typeof config.precision === 'number' ? { precision: config.precision } : {}),
                },
            };
        case 'percent':
            return { kind: 'number', unit: { kind: 'percent' } };
        case 'duration':
            return { kind: 'number', unit: { kind: 'duration' } };
        case 'number':
            return { kind: 'number' };
        case 'checkbox':
            return { kind: 'boolean' };
        case 'date':
            return { kind: 'date' };
        case 'datetime':
            return { kind: 'datetime' };
        case 'text':
            return { kind: 'text' };
    }
}

/** Tipos de los argumentos que devuelven las funciones. */
function callType(node: Extract<FormulaNode, { k: 'call' }>, arg: (i: number) => FormulaTypeInfo): FormulaTypeInfo {
    switch (node.fn) {
        case 'SI': {
            const a = arg(1);
            const b = node.args.length > 2 ? arg(2) : null;
            if (!b || isBlankLiteral(node.args[2]!)) return a;
            if (isBlankLiteral(node.args[1]!)) return b;
            return a.kind === b.kind ? { kind: a.kind, unit: sameUnit(a.unit, b.unit) } : { kind: 'text' };
        }
        case 'SWITCH': {
            const results: FormulaTypeInfo[] = [];
            for (let i = 2; i < node.args.length; i += 2) results.push(arg(i));
            if (node.args.length % 2 === 0) results.push(arg(node.args.length - 1));
            const first = results[0] ?? { kind: 'text' as const };
            return results.every((r) => r.kind === first.kind) ? first : { kind: 'text' };
        }
        case 'SI.ERROR': {
            const a = arg(0);
            const b = arg(1);
            return a.kind === b.kind ? { kind: a.kind, unit: sameUnit(a.unit, b.unit) } : { kind: 'text' };
        }
        case 'Y':
        case 'O':
        case 'NO':
        case 'ESBLANCO':
        case 'REGEX_COINCIDE':
        case 'CONTIENE':
        case 'VERDADERO':
        case 'FALSO':
            return { kind: 'boolean' };
        case 'BLANCO':
            return { kind: 'text' };
        case 'CONCATENAR':
        case 'MAYUSC':
        case 'MINUSC':
        case 'IZQUIERDA':
        case 'DERECHA':
        case 'EXTRAER':
        case 'REEMPLAZAR':
        case 'ESPACIOS':
        case 'FORMATO_FECHA':
        case 'TEXTO':
        case 'LETRAS':
        case 'PESOS':
            return { kind: 'text' };
        case 'LARGO':
        case 'DIAS_ENTRE':
        case 'MESES_ENTRE':
        case 'DIA_SEMANA':
        case 'ANIO':
        case 'MES':
        case 'DIA':
        case 'VALOR':
        case 'POTENCIA':
            return { kind: 'number' };
        case 'REDONDEAR':
        case 'REDONDEAR.MAS':
        case 'REDONDEAR.MENOS':
        case 'ABS':
        case 'ENTERO':
        case 'RESIDUO':
            return { kind: 'number', unit: arg(0).unit ?? null };
        case 'MAX':
        case 'MIN': {
            const all = node.args.map((_, i) => arg(i));
            if (all.length > 0 && all.every((t) => t.kind === 'date')) return { kind: 'date' };
            if (all.length > 0 && all.every((t) => t.kind === 'date' || t.kind === 'datetime')) return { kind: 'datetime' };
            return { kind: 'number', unit: unitOfAll(all) };
        }
        case 'SUMA':
        case 'PROMEDIO':
            return { kind: 'number', unit: unitOfAll(node.args.map((_, i) => arg(i))) };
        case 'HOY':
            return { kind: 'date' };
        case 'AHORA':
            return { kind: 'datetime' };
        case 'SUMAR_DIAS':
        case 'SUMAR_MESES':
        case 'SUMAR_DIAS_HABILES': {
            const a = arg(0);
            return { kind: a.kind === 'datetime' ? 'datetime' : 'date' };
        }
        case 'FECHA':
            return { kind: 'date' };
        default:
            return { kind: 'text' };
    }
}

function isBlankLiteral(n: FormulaNode): boolean {
    return (n.k === 'call' && n.fn === 'BLANCO') || (n.k === 'str' && n.v === '');
}

function sameUnit(a: FormulaUnit | undefined, b: FormulaUnit | undefined): FormulaUnit {
    if (!a) return b ?? null;
    if (!b) return a;
    return unitKey(a) === unitKey(b) ? a : null;
}

function unitKey(u: FormulaUnit | undefined): string {
    if (!u) return '';
    return u.kind === 'currency' ? `currency:${u.currency}` : u.kind;
}

function unitOfAll(all: FormulaTypeInfo[]): FormulaUnit {
    const units = all.filter((t) => t.kind === 'number').map((t) => t.unit ?? null);
    const withUnit = units.filter((u): u is NonNullable<FormulaUnit> => u !== null);
    if (withUnit.length === 0) return null;
    const first = withUnit[0]!;
    return withUnit.every((u) => unitKey(u) === unitKey(first)) ? first : null;
}

/**
 * Tipo de una pieza de la fórmula. `refType(name)` da el tipo de cada
 * referencia (`{#12}`): quien llama decide de dónde sale.
 */
export function inferNodeType(node: FormulaNode, refType: (name: string) => FormulaTypeInfo): FormulaTypeInfo {
    const t = (n: FormulaNode): FormulaTypeInfo => inferNodeType(n, refType);
    switch (node.k) {
        case 'num':
            return { kind: 'number' };
        case 'str':
            return { kind: 'text' };
        case 'bool':
            return { kind: 'boolean' };
        case 'ref':
            return refType(node.name);
        case 'neg':
            return { kind: 'number', unit: t(node.arg).unit ?? null };
        case 'pct':
            return { kind: 'number' };
        case 'call':
            return callType(node, (i) => t(node.args[i]!));
        case 'bin': {
            if (node.op === '&') return { kind: 'text' };
            if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) return { kind: 'boolean' };
            const l = t(node.l);
            const r = t(node.r);
            const isDate = (x: FormulaTypeInfo) => x.kind === 'date' || x.kind === 'datetime';
            // Fechas: fecha ± días = fecha; fecha − fecha = días.
            if (node.op === '+' || node.op === '-') {
                if (isDate(l) && r.kind === 'number') return { kind: l.kind };
                if (node.op === '+' && isDate(r) && l.kind === 'number') return { kind: r.kind };
                if (node.op === '-' && isDate(l) && isDate(r)) return { kind: 'number' };
                return { kind: 'number', unit: sameUnit(l.unit, r.unit) };
            }
            if (node.op === '*') {
                // moneda × número = moneda; moneda × moneda = número.
                if (l.unit && !r.unit) return { kind: 'number', unit: l.unit };
                if (r.unit && !l.unit) return { kind: 'number', unit: r.unit };
                return { kind: 'number' };
            }
            if (node.op === '/') {
                // moneda ÷ número = moneda; moneda ÷ moneda = una proporción.
                if (l.unit && !r.unit) return { kind: 'number', unit: l.unit };
                return { kind: 'number' };
            }
            return { kind: 'number' };
        }
    }
}

/** El tipo de resultado que se infiere de un tipo. */
export function resultTypeFromInfo(info: FormulaTypeInfo): FormulaResultType {
    switch (info.kind) {
        case 'number':
            if (info.unit?.kind === 'currency') return 'currency';
            if (info.unit?.kind === 'percent') return 'percent';
            if (info.unit?.kind === 'duration') return 'duration';
            return 'number';
        case 'boolean':
            return 'checkbox';
        case 'date':
            return 'date';
        case 'datetime':
            return 'datetime';
        case 'text':
            return 'text';
    }
}

export interface FormulaConfigLike {
    formula?: unknown;
    result_type?: unknown;
    currency?: unknown;
    precision?: unknown;
}

/** Tipo de una referencia `{#id}` dentro de una lista. */
export function refTypeResolver(ctx: {
    fields: ReadonlyMap<number, FormulaTypingField>;
    throughTarget?: ThroughTargetOf;
    visiting?: Set<number>;
}): (name: string) => FormulaTypeInfo {
    return (name: string) => {
        const id = storedRefId(name);
        const f = id === null ? undefined : ctx.fields.get(id);
        return f ? kindOfField(f, ctx) : { kind: 'text' };
    };
}

/** El tipo de resultado INFERIDO de una fórmula guardada (o `text` si no se puede leer). */
export function inferFormulaResultType(
    stored: string,
    ctx: { fields: ReadonlyMap<number, FormulaTypingField>; throughTarget?: ThroughTargetOf; visiting?: Set<number> },
): { type: FormulaResultType; info: FormulaTypeInfo } {
    const parsed = parseFormulaCached(stored);
    if (!parsed.ok) return { type: 'text', info: { kind: 'text' } };
    const info = inferNodeType(parsed.ast, refTypeResolver(ctx));
    return { type: resultTypeFromInfo(info), info };
}

/** El tipo de resultado EFECTIVO de un campo fórmula: el elegido o, si no, el inferido. */
export function formulaResultTypeOf(
    field: FormulaTypingField,
    ctx: { fields: ReadonlyMap<number, FormulaTypingField>; throughTarget?: ThroughTargetOf; visiting?: Set<number> },
): FormulaResultType {
    const cfg = cfgOf(field) as FormulaConfigLike;
    if (typeof cfg.result_type === 'string' && (FORMULA_RESULT_TYPES as readonly string[]).includes(cfg.result_type)) {
        return cfg.result_type as FormulaResultType;
    }
    return inferFormulaResultType(typeof cfg.formula === 'string' ? cfg.formula : '', ctx).type;
}

/**
 * La moneda y los decimales con que se muestra el resultado: los elegidos o,
 * si la fórmula es de moneda/porcentaje, los del campo de donde sale.
 */
export function formulaDisplayConfig(
    field: FormulaTypingField,
    ctx: { fields: ReadonlyMap<number, FormulaTypingField>; throughTarget?: ThroughTargetOf; visiting?: Set<number> },
): { type: FormulaResultType; config: Record<string, unknown> } {
    const cfg = cfgOf(field) as FormulaConfigLike;
    const type = formulaResultTypeOf(field, ctx);
    const inferred = inferFormulaResultType(typeof cfg.formula === 'string' ? cfg.formula : '', ctx).info;
    const config: Record<string, unknown> = {};
    if (typeof cfg.precision === 'number') config.precision = cfg.precision;
    if (type === 'currency') {
        const unitCurrency = inferred.unit?.kind === 'currency' ? inferred.unit.currency : undefined;
        config.currency = typeof cfg.currency === 'string' && cfg.currency !== '' ? cfg.currency : (unitCurrency ?? 'USD');
        if (config.precision === undefined && inferred.unit?.kind === 'currency' && inferred.unit.precision !== undefined) {
            config.precision = inferred.unit.precision;
        }
    }
    if (type === 'percent' && config.precision === undefined && inferred.unit?.kind === 'percent' && inferred.unit.precision !== undefined) {
        config.precision = inferred.unit.precision;
    }
    if (type === 'number' && config.precision === undefined) config.precision = 2;
    return { type, config };
}

// ─── Validación completa (al guardar y en el editor) ───────────────────

export interface FormulaCheckIssue {
    message: string;
    start: number;
    end: number;
}

/**
 * Revisa una fórmula GUARDADA contra los campos de su lista: sintaxis,
 * campos que existen y se pueden usar, y ciclos entre fórmulas (A usa B y B
 * usa A). `selfId` es la fórmula que se está guardando (null si es nueva).
 */
export function checkStoredFormula(
    stored: string,
    fields: readonly FormulaTypingField[],
    selfId: number | null,
): FormulaCheckIssue | null {
    const parsed = parseFormulaCached(stored);
    if (!parsed.ok) return issueFrom(parsed.error);
    const byId = new Map(fields.map((f) => [f.id, f]));
    let issue: FormulaCheckIssue | null = null;
    walkFormula(parsed.ast, (n) => {
        if (issue || n.k !== 'ref') return;
        const id = storedRefId(n.name);
        const f = id === null ? undefined : byId.get(id);
        if (!f) {
            issue = { message: `El campo de ${positionText(stored, n.start)} ya no existe.`, start: n.start, end: n.end };
            return;
        }
        if (selfId !== null && f.id === selfId) {
            issue = { message: `Una fórmula no puede usarse a sí misma (${positionText(stored, n.start)}).`, start: n.start, end: n.end };
            return;
        }
        const notAllowed = formulaRefNotAllowed(f.type);
        if (notAllowed) issue = { message: `${notAllowed} (${f.label ?? `#${f.id}`})`, start: n.start, end: n.end };
    });
    if (issue) return issue;
    const cycle = findFormulaCycle(stored, fields, selfId);
    if (cycle) {
        return {
            message: `Las fórmulas se usan entre sí en círculo: ${cycle.map((f) => `«${f.label ?? `#${f.id}`}»`).join(' → ')}. Una de ellas tiene que dejar de usar a la otra.`,
            start: 0,
            end: stored.length,
        };
    }
    return null;
}

function issueFrom(e: FormulaSyntaxError): FormulaCheckIssue {
    return { message: e.message, start: e.start, end: e.end };
}

/** Ids de los campos que usa la fórmula guardada de un campo. */
export function formulaDependencies(config: Record<string, unknown> | null | undefined): number[] {
    const text = typeof config?.formula === 'string' ? config.formula : '';
    if (text === '') return [];
    const parsed = parseFormulaCached(text);
    const out: number[] = [];
    if (!parsed.ok) {
        for (const m of text.matchAll(/\{#(\d+)\}/g)) {
            const id = Number(m[1]);
            if (!out.includes(id)) out.push(id);
        }
        return out;
    }
    walkFormula(parsed.ast, (n) => {
        if (n.k !== 'ref') return;
        const id = storedRefId(n.name);
        if (id !== null && !out.includes(id)) out.push(id);
    });
    return out;
}

/**
 * ¿La fórmula (con el texto `stored` para el campo `selfId`) forma un ciclo
 * con otras fórmulas de la lista? Devuelve el camino del ciclo o null.
 */
export function findFormulaCycle(
    stored: string,
    fields: readonly FormulaTypingField[],
    selfId: number | null,
): FormulaTypingField[] | null {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const depsOf = (id: number): number[] => {
        if (selfId !== null && id === selfId) return formulaDependencies({ formula: stored });
        const f = byId.get(id);
        return f?.type === 'formula' ? formulaDependencies(f.config ?? {}) : [];
    };
    const self: FormulaTypingField = selfId !== null ? (byId.get(selfId) ?? { id: selfId, type: 'formula' }) : { id: -1, type: 'formula', label: 'esta fórmula' };
    const start = formulaDependencies({ formula: stored });
    const stack: FormulaTypingField[] = [self];
    const seen = new Set<number>();
    const visit = (id: number, depth: number): FormulaTypingField[] | null => {
        if (depth > 64) return null;
        const f = byId.get(id);
        if (!f || f.type !== 'formula') return null;
        if (selfId !== null && id === selfId) return [...stack, f];
        if (stack.some((s) => s.id === id)) return null;
        if (seen.has(id)) return null;
        seen.add(id);
        stack.push(f);
        for (const d of depsOf(id)) {
            const hit = visit(d, depth + 1);
            if (hit) return hit;
        }
        stack.pop();
        return null;
    };
    for (const d of start) {
        const hit = visit(d, 0);
        if (hit) return hit;
    }
    return null;
}

/**
 * Las fórmulas de la lista que dependen (directa o indirectamente) de alguno
 * de `ids` — para ocultarlas junto con un campo oculto (SEC-36) y para avisar
 * qué fórmulas se quedan sin un campo que se borra.
 */
export function formulasDependingOn(
    fields: ReadonlyArray<{ id: number; type: string; config?: Record<string, unknown> | null }>,
    ids: ReadonlySet<number>,
): Set<number> {
    const out = new Set<number>();
    let changed = true;
    while (changed) {
        changed = false;
        for (const f of fields) {
            if (f.type !== 'formula' || out.has(f.id)) continue;
            if (formulaDependencies(f.config ?? {}).some((d) => ids.has(d) || out.has(d))) {
                out.add(f.id);
                changed = true;
            }
        }
    }
    return out;
}
