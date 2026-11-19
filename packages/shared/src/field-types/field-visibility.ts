import { jsonbKeyForField, type FieldType } from '../schemas/field';
import {
    SHOW_IF_MAX_CONDITIONS,
    SHOW_IF_OPS,
    type FieldShowIf,
    type FieldShowIfCondition,
    type ShowIfOp,
} from '../schemas/field-rules';
import { evaluateFilterCondition } from './conditions';

/**
 * A7 (v0.1.457) — «Mostrar sólo si…»: campos que aparecen según otros.
 *
 * La condición vive en `field.config.show_if` (ver schemas/field-rules.ts).
 * Estas funciones son las ÚNICAS que la evalúan: las usan el alta, el modal,
 * la página y la ficha diseñada (qué filas se dibujan), la tabla (la celda
 * que no aplica se atenúa) y el servidor (un campo oculto por su condición
 * NO es obligatorio: ni «obligatorio» ni «obligatorio si»). Así el navegador
 * y el servidor deciden igual.
 *
 * Reglas:
 *  - Una regla cuyo campo ya no existe (borrado, en la papelera, o que no se
 *    puede usar como condición) NO aplica: si no queda ninguna, el campo se
 *    muestra. Nunca se esconde un campo por una referencia muerta.
 *  - En CASCADA: si el campo de la condición está oculto por la suya, su
 *    valor cuenta como vacío (como una pregunta saltada en un formulario).
 *  - El valor guardado de un campo oculto NO se borra: sólo no se muestra ni
 *    se exige.
 *  - Los ciclos (A depende de B y B de A) se rechazan al guardar; si uno se
 *    cuela, el campo del ciclo se muestra.
 */

interface VisField {
    id: number;
    type: FieldType | string;
    label?: string;
    slug?: string;
    config: Record<string, unknown>;
}

const NUMERIC: readonly string[] = ['number', 'currency', 'percent', 'rating', 'duration'];
const TEXTUAL: readonly string[] = ['text', 'long_text', 'email', 'url', 'phone'];

/**
 * Los operadores con los que un campo de este tipo puede ser la CONDICIÓN de
 * otro (vacío = no se puede usar). Sólo campos que se escriben a mano y viven
 * en los datos: un calculado o una relación no están en el registro al
 * guardarlo, y una fecha y hora dependería del reloj.
 */
export function showIfSourceOps(type: FieldType | string): readonly ShowIfOp[] {
    if (type === 'select') return ['eq', 'neq', 'in', 'nin', 'is_null', 'is_not_null'];
    if (type === 'multi_select') return ['contains', 'not_contains', 'in', 'nin', 'is_null', 'is_not_null'];
    if (type === 'checkbox') return ['eq'];
    if (NUMERIC.includes(type)) return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
    if (TEXTUAL.includes(type)) return ['eq', 'neq', 'contains', 'not_contains', 'is_null', 'is_not_null'];
    if (type === 'date') return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'];
    if (type === 'datetime' || type === 'user' || type === 'team' || type === 'file') return ['is_null', 'is_not_null'];
    return [];
}

/** ¿El operador necesita un valor? */
export function showIfOpNeedsValue(op: ShowIfOp): boolean {
    return op !== 'is_null' && op !== 'is_not_null';
}

const isEmptyValue = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * La condición del campo, leída con tolerancia (null si no tiene ninguna
 * regla utilizable): reglas sin campo, con un operador desconocido o sin el
 * valor que el operador pide se descartan.
 */
export function fieldShowIfOf(config: Record<string, unknown> | null | undefined): FieldShowIf | null {
    const raw = (config ?? {}).show_if;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as { logic?: unknown; conditions?: unknown };
    if (!Array.isArray(r.conditions)) return null;
    const conditions: FieldShowIfCondition[] = [];
    for (const c of r.conditions.slice(0, SHOW_IF_MAX_CONDITIONS)) {
        if (!c || typeof c !== 'object') continue;
        const cc = c as { field_id?: unknown; op?: unknown; value?: unknown };
        const fieldId = typeof cc.field_id === 'number' && Number.isInteger(cc.field_id) && cc.field_id > 0 ? cc.field_id : null;
        if (fieldId === null) continue;
        if (typeof cc.op !== 'string' || !(SHOW_IF_OPS as readonly string[]).includes(cc.op)) continue;
        const op = cc.op as ShowIfOp;
        if (showIfOpNeedsValue(op) && isEmptyValue(cc.value) && cc.value !== false) continue;
        conditions.push(showIfOpNeedsValue(op) ? { field_id: fieldId, op, value: cc.value } : { field_id: fieldId, op });
    }
    if (conditions.length === 0) return null;
    return { logic: r.logic === 'or' ? 'or' : 'and', conditions };
}

/** Los ids de los campos de los que depende la condición (sin repetir). */
export function showIfControllerIds(config: Record<string, unknown> | null | undefined): number[] {
    const rule = fieldShowIfOf(config);
    if (!rule) return [];
    return [...new Set(rule.conditions.map((c) => c.field_id).filter((id): id is number => typeof id === 'number'))];
}

/**
 * Los campos ocultos por su condición para estos datos (claves `f{id}`):
 * id → la condición que no se cumple. Los demás se muestran.
 */
export function fieldsHiddenByCondition(
    fields: ReadonlyArray<VisField>,
    data: Record<string, unknown>,
): Map<number, FieldShowIf> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const cache = new Map<number, boolean>();
    const visiting = new Set<number>();
    const hidden = new Map<number, FieldShowIf>();

    const isVisible = (f: VisField): boolean => {
        const known = cache.get(f.id);
        if (known !== undefined) return known;
        const rule = fieldShowIfOf(f.config);
        if (!rule) {
            cache.set(f.id, true);
            return true;
        }
        // Un ciclo que se coló (no se guarda): el campo se muestra.
        if (visiting.has(f.id)) return true;
        visiting.add(f.id);
        const results: boolean[] = [];
        for (const c of rule.conditions) {
            const other = typeof c.field_id === 'number' ? byId.get(c.field_id) : undefined;
            if (!other || other.id === f.id || !showIfSourceOps(other.type).includes(c.op)) continue;
            // Cascada: lo que está oculto por su condición cuenta como vacío.
            const value = isVisible(other) ? data[jsonbKeyForField(other.id)] : undefined;
            const r = evaluateFilterCondition({ op: c.op, value: c.value }, { type: String(other.type), value });
            if (r !== null) results.push(r);
        }
        visiting.delete(f.id);
        const ok = results.length === 0 ? true : rule.logic === 'or' ? results.some(Boolean) : results.every(Boolean);
        cache.set(f.id, ok);
        if (!ok) hidden.set(f.id, rule);
        return ok;
    };

    for (const f of fields) isVisible(f);
    return hidden;
}

/** Atajo: ¿este campo se muestra con estos datos? */
export function isFieldShown(fields: ReadonlyArray<VisField>, fieldId: number, data: Record<string, unknown>): boolean {
    return !fieldsHiddenByCondition(fields, data).has(fieldId);
}

/**
 * Si guardar `nextRule` en el campo `selfId` cerraría un ciclo, devuelve el
 * camino (ids, empezando y terminando en `selfId`); si no, null.
 */
export function showIfCycle(
    fields: ReadonlyArray<VisField>,
    selfId: number,
    nextRule: FieldShowIf | null,
): number[] | null {
    const edges = new Map<number, number[]>();
    for (const f of fields) {
        if (f.id === selfId) continue;
        edges.set(f.id, showIfControllerIds(f.config));
    }
    edges.set(selfId, nextRule ? [...new Set(nextRule.conditions.map((c) => c.field_id).filter((id): id is number => typeof id === 'number'))] : []);
    const path: number[] = [];
    const seen = new Set<number>();
    const dfs = (id: number): boolean => {
        if (id === selfId && path.length > 0) {
            path.push(id);
            return true;
        }
        if (seen.has(id)) return false;
        seen.add(id);
        path.push(id);
        for (const next of edges.get(id) ?? []) if (dfs(next)) return true;
        path.pop();
        return false;
    };
    return dfs(selfId) ? path : null;
}

/** Los campos cuya condición menciona `fieldId` (para avisar antes de borrarlo). */
export function showIfDependents<F extends VisField>(fields: ReadonlyArray<F>, fieldId: number): F[] {
    return fields.filter((f) => f.id !== fieldId && showIfControllerIds(f.config).includes(fieldId));
}

/** Reglas cuyo campo ya no está en la lista (para el aviso del editor). */
export function showIfDeadConditions(config: Record<string, unknown> | null | undefined, fields: ReadonlyArray<VisField>): number {
    const rule = fieldShowIfOf(config);
    if (!rule) return 0;
    const ids = new Set(fields.map((f) => f.id));
    return rule.conditions.filter((c) => typeof c.field_id !== 'number' || !ids.has(c.field_id)).length;
}

// ─── Textos ──────────────────────────────────────────────────────────────

const OP_TEXT: Record<ShowIfOp, string> = {
    eq: 'es',
    neq: 'no es',
    in: 'es alguno de',
    nin: 'no es ninguno de',
    contains: 'contiene',
    not_contains: 'no contiene',
    gt: 'es mayor que',
    gte: 'es mayor o igual a',
    lt: 'es menor que',
    lte: 'es menor o igual a',
    is_null: 'está vacío',
    is_not_null: 'tiene un valor',
};

/** Cómo se lee el operador para un campo de este tipo (la UI y los textos). */
export function showIfOpLabel(op: ShowIfOp, type: FieldType | string): string {
    if (type === 'multi_select') {
        if (op === 'contains') return 'incluye';
        if (op === 'not_contains') return 'no incluye';
        if (op === 'in') return 'incluye alguno de';
        if (op === 'nin') return 'no incluye ninguno de';
    }
    if (type === 'date') {
        if (op === 'gt') return 'es posterior al';
        if (op === 'gte') return 'es el o después del';
        if (op === 'lt') return 'es anterior al';
        if (op === 'lte') return 'es el o antes del';
    }
    return OP_TEXT[op];
}

function optionLabel(field: VisField, v: unknown): string {
    const options = Array.isArray(field.config.options) ? (field.config.options as Array<{ value?: unknown; label?: unknown }>) : [];
    const o = options.find((x) => x.value === v);
    return typeof o?.label === 'string' && o.label !== '' ? o.label : String(v ?? '');
}

/** Una regla en palabras: «Tipo de cliente» es «Empresa». */
export function describeShowIfCondition(c: FieldShowIfCondition, other: VisField | undefined): string {
    const name = other?.label ? `«${other.label}»` : 'un campo que ya no existe';
    if (!other) return name;
    if (other.type === 'checkbox') {
        const on = c.value === true || c.value === 'true' || c.value === 1 || c.value === '1';
        return `${name} ${on ? 'está marcada' : 'no está marcada'}`;
    }
    const op = showIfOpLabel(c.op, other.type);
    if (!showIfOpNeedsValue(c.op)) return `${name} ${op}`;
    const items = Array.isArray(c.value) ? c.value : [c.value];
    const shown = items.map((v) => `«${optionLabel(other, v)}»`).join(c.op === 'in' || c.op === 'nin' ? ', ' : ' y ');
    return `${name} ${op} ${shown}`;
}

/** La condición entera en palabras («Tipo» es «Empresa» y «País» es «CO»). */
export function describeShowIf(rule: FieldShowIf, fields: ReadonlyArray<VisField>): string {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const parts = rule.conditions.map((c) => describeShowIfCondition(c, typeof c.field_id === 'number' ? byId.get(c.field_id) : undefined));
    return parts.join(rule.logic === 'or' ? ' o ' : ' y ');
}

/** El motivo de una celda que no aplica: «Se muestra sólo si «Tipo» es «Empresa».» */
export function showIfHiddenReason(rule: FieldShowIf, fields: ReadonlyArray<VisField>): string {
    return `Este campo no aplica aquí: se muestra sólo si ${describeShowIf(rule, fields)}.`;
}
