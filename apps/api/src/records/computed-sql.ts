import {
    COMPUTED_MAX_DEPTH,
    FALLBACK_TIME_ZONE,
    isSystemField,
    readApprovalFlowId,
    systemFieldBaseType,
    type Field,
    type FieldType,
    type SystemFieldType,
} from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import { approvalStatusExpr } from '../approvals/approval-sql';
import { records } from '../db/schema';
import { fieldTypedExpr, type FilterableField } from './query-builder';
import { compileFormulaField, formulaGroupExpr } from './formula-sql';

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
    /** v0.1.300 — zona de la empresa: agrupar por una fecha de sistema cuenta el día en su reloj. */
    timeZone: string = FALLBACK_TIME_ZONE,
    /** Fórmulas (A1) — el «ahora» de la lectura (HOY() y AHORA() en SQL). */
    now: Date = new Date(),
): Map<number, FilterableField> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out = new Map(available);
    // v0.1.300 — columnas de sistema: su valor es una columna de `records`.
    for (const f of fields) {
        if (!isSystemField(f.type) || !available.has(f.id)) continue;
        out.set(f.id, systemFilterable(f.id, f.type, timeZone));
    }
    // v0.1.291 — «Tiempo registrado»: la suma de `time_entries` del registro
    // (antes que los computed: un computed puede usarlo como entrada).
    for (const f of fields) {
        if (f.type !== 'time_tracked' || !available.has(f.id)) continue;
        out.set(f.id, { id: f.id, type: 'time_tracked', expr: timeTrackedExpr(), valueKind: 'numeric' });
    }
    // C5 — «Aprobación»: el estado de la última solicitud del registro (de su
    // flujo). Filtra («pendientes»), ordena y agrupa por la subconsulta.
    for (const f of fields) {
        if (f.type !== 'approval' || !available.has(f.id)) continue;
        const expr = approvalStatusExpr(readApprovalFlowId(f.config as Record<string, unknown>));
        out.set(f.id, { id: f.id, type: 'approval', expr, valueKind: 'text', groupExpr: expr });
    }
    for (const f of fields) {
        if (f.type !== 'computed' || !available.has(f.id)) continue;
        const expr = computedExpr(f, byId, out, new Set(), 0);
        if (expr) out.set(f.id, { id: f.id, type: 'computed', expr, valueKind: 'numeric' });
    }
    // Fórmulas (A1): las que compilan a SQL filtran, ordenan, agrupan y se
    // suman; las que no, quedan sin expresión y con el motivo (la interfaz no
    // las ofrece para filtrar y el motor de agregados lo dice).
    for (const f of fields) {
        if (f.type !== 'formula' || !available.has(f.id)) continue;
        const res = compileFormulaField(f, { fields: byId, available: out, timeZone, now });
        out.set(
            f.id,
            res.ok
                ? {
                      id: f.id,
                      type: 'formula',
                      expr: res.expr,
                      valueKind: res.kind === 'number' ? 'numeric' : 'text',
                      formulaKind: res.kind,
                      groupExpr: formulaGroupExpr(res.expr, res.kind, timeZone),
                  }
                : { id: f.id, type: 'formula', formulaReason: res.reason },
        );
    }
    return out;
}

/**
 * v0.1.291 — Minutos registrados en el registro de la fila (`records.id`):
 * la subconsulta correlacionada que filtra, ordena, agrupa y suma el campo
 * `time_tracked`, igual que la de un rollup. Un cronómetro en curso tiene
 * `seconds = 0`, así que la suma no necesita filtrar; el índice
 * `(record_id, seconds)` la resuelve sin tocar la tabla.
 */
export function timeTrackedExpr(): SQL {
    // La columna va ANIDADA (defensivo): como chunk de primer nivel, drizzle
    // la escribe sin tabla (`"id"`) si la expresión llega tal cual como
    // columna del SELECT de una sola tabla, y dentro de la subconsulta `"id"`
    // sería `te.id`. Ver `approvalStatusExpr`, donde sí pasaba.
    const recordId = sql`${records.id}`;
    return sql`(SELECT round(coalesce(sum(te.seconds), 0) / 60.0) FROM time_entries te WHERE te.record_id = ${recordId})`;
}

/**
 * v0.1.300 — Expresión SQL de una columna de sistema sobre la fila de `records`.
 * «Modificado por» de un registro que NUNCA se modificó es quien lo creó; uno
 * modificado antes de que existiera `updated_by` queda sin dato (NULL).
 */
export function systemFieldExpr(type: SystemFieldType): SQL {
    switch (type) {
        case 'created_at':
            return sql`${records.createdAt}`;
        case 'updated_at':
            return sql`${records.updatedAt}`;
        case 'created_by':
            return sql`${records.createdBy}`;
        case 'updated_by':
            return sql`coalesce(${records.updatedBy}, CASE WHEN ${records.updatedAt} = ${records.createdAt} THEN ${records.createdBy} END)`;
    }
}

/**
 * Entrada del whitelist filtrable de una columna de sistema: la expresión, y
 * la clave de AGRUPADO — una fecha se agrupa por DÍA en el reloj de la
 * empresa (agrupar por el instante exacto daría un grupo por registro); una
 * persona, por su id. `valueKind: 'text'`: una fecha o una persona no se suma.
 */
export function systemFilterable(id: number, type: SystemFieldType, timeZone: string): FilterableField {
    const expr = systemFieldExpr(type);
    const groupExpr =
        systemFieldBaseType(type) === 'datetime'
            ? sql`to_char((${expr}) AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`
            : sql`(${expr})::text`;
    return { id, type, expr, valueKind: 'text', groupExpr };
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
    // Un rollup numérico resuelto (o el tiempo registrado) entra con su subconsulta.
    if (input.type === 'rollup' || input.type === 'time_tracked') {
        return ff?.expr && ff.valueKind !== 'text' ? sql`(${ff.expr})::numeric` : undefined;
    }
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
