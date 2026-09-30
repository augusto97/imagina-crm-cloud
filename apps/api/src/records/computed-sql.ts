import { COMPUTED_MAX_DEPTH, type Field, type FieldType } from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import { fieldTypedExpr, type FilterableField } from './query-builder';

/**
 * v0.1.229 — Campos `computed` NUMÉRICOS como expresión SQL.
 *
 * Un computed se evalúa en JS en cada lectura (jamás se persiste), así que el
 * motor de agregados, los filtros y el orden no lo veían: un tablero que
 * sumaba «Valor en inventario = stock × costo» respondía «sum sólo aplica a
 * campos numéricos». Las operaciones ARITMÉTICAS (sum, product, subtract,
 * divide, abs) tienen traducción directa a SQL sobre las entradas tipadas, y
 * con la expresión el campo pasa a comportarse como un rollup: se suma, se
 * promedia, se filtra ("margen < 0") y se ordena.
 *
 * Misma semántica que `evaluateComputed` (shared):
 *  - sum/product ignoran las entradas vacías y dan NULL si TODAS lo están;
 *  - subtract/abs propagan el vacío; divide por cero da NULL.
 *
 * Quedan afuera (sin expresión → el campo sigue sin agregarse, como antes):
 * las operaciones de fecha y `concat`, y cualquier computed con una entrada
 * que no sea numérica, que no exista o que esté OCULTA para quien pregunta
 * (se compila sobre el mapa YA recortado por el ACL: si una entrada oculta
 * entrara a la expresión, filtrar por el computed sería un oráculo sobre
 * ella).
 */

const NUMERIC_INPUT_TYPES: readonly FieldType[] = ['number', 'currency', 'rating', 'percent', 'duration'];

type NumericOp = 'sum' | 'product' | 'subtract' | 'divide' | 'abs';
const NUMERIC_OPS: ReadonlySet<string> = new Set<NumericOp>(['sum', 'product', 'subtract', 'divide', 'abs']);

/**
 * Agrega al mapa filtrable una entrada con `expr` por cada computed numérico
 * compilable de `fields`. `available` es el mapa ya filtrado por el ACL: sólo
 * se usan entradas presentes en él.
 */
export function withComputedExprs(
    available: Map<number, FilterableField>,
    fields: readonly Field[],
): Map<number, FilterableField> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out = new Map(available);
    for (const f of fields) {
        if (f.type !== 'computed' || !available.has(f.id)) continue;
        const expr = computedExpr(f, byId, available, new Set(), 0);
        if (expr) out.set(f.id, { id: f.id, type: 'computed', expr, valueKind: 'numeric' });
    }
    return out;
}

/** ¿El computed tiene una operación que se puede llevar a SQL? (para la UI/asistente). */
export function isNumericComputed(field: Pick<Field, 'type' | 'config'>): boolean {
    return field.type === 'computed' && NUMERIC_OPS.has(String((field.config as Record<string, unknown>).operation ?? ''));
}

function computedExpr(
    field: Field,
    byId: Map<number, Field>,
    available: Map<number, FilterableField>,
    visiting: ReadonlySet<number>,
    depth: number,
): SQL | undefined {
    if (depth > COMPUTED_MAX_DEPTH || visiting.has(field.id)) return undefined;
    const cfg = field.config as Record<string, unknown>;
    const op = String(cfg.operation ?? '');
    if (!NUMERIC_OPS.has(op)) return undefined;
    const rawInputs = Array.isArray(cfg.inputs) ? cfg.inputs : [];
    if (rawInputs.length === 0) return undefined;

    const next = new Set(visiting);
    next.add(field.id);
    const inputs: SQL[] = [];
    for (const raw of rawInputs) {
        const id = typeof raw === 'number' ? raw : Number(raw);
        const input = Number.isInteger(id) ? byId.get(id) : undefined;
        if (!input || !available.has(input.id)) return undefined; // borrado u oculto
        const e = inputExpr(input, byId, available, next, depth + 1);
        if (!e) return undefined;
        inputs.push(e);
    }
    return applyOp(op as NumericOp, inputs);
}

function inputExpr(
    input: Field,
    byId: Map<number, Field>,
    available: Map<number, FilterableField>,
    visiting: ReadonlySet<number>,
    depth: number,
): SQL | undefined {
    if (input.type === 'computed') return computedExpr(input, byId, available, visiting, depth);
    const ff = available.get(input.id);
    // Un rollup numérico resuelto entra con su subconsulta.
    if (input.type === 'rollup') return ff?.expr && ff.valueKind !== 'text' ? sql`(${ff.expr})::numeric` : undefined;
    if (NUMERIC_INPUT_TYPES.includes(input.type)) return fieldTypedExpr({ id: input.id, type: input.type });
    return undefined;
}

function applyOp(op: NumericOp, inputs: SQL[]): SQL | undefined {
    const [a, b] = inputs;
    switch (op) {
        case 'sum':
        case 'product': {
            const neutral = op === 'sum' ? sql`0` : sql`1`;
            const joiner = op === 'sum' ? sql` + ` : sql` * `;
            const anyPresent = sql.join(inputs.map((e) => sql`(${e}) IS NOT NULL`), sql` OR `);
            const body = sql.join(inputs.map((e) => sql`COALESCE(${e}, ${neutral})`), joiner);
            return sql`(CASE WHEN ${anyPresent} THEN ${body} END)`;
        }
        case 'subtract':
            return a && b ? sql`((${a}) - (${b}))` : undefined;
        case 'divide':
            return a && b ? sql`((${a}) / NULLIF(${b}, 0))` : undefined;
        case 'abs':
            return a ? sql`abs(${a})` : undefined;
    }
}
