import {
    evaluateRowFormulas,
    formulaDependencies,
    FALLBACK_TIME_ZONE,
    jsonbKeyForField,
    tenantFormatSchema,
    type Field,
    type FormulaEnv,
    type ThroughTargetOf,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { memberships, tenants, users } from '../db/schema';
import type { ThroughPlan } from './through-fields';

/**
 * Fórmulas (A1) — lo que hace falta para CALCULARLAS en una lectura: el
 * formato regional y la zona de la empresa (HOY(), TEXTO(), FORMATO_FECHA()),
 * los nombres de las personas (un campo persona se lee por su nombre) y el
 * campo del otro lado de cada lookup/rollup. Se arma UNA vez por lectura y
 * sólo si la lista tiene fórmulas: el resto de las listas no paga nada.
 */
export interface FormulaRuntime {
    env: FormulaEnv;
    throughTarget?: ThroughTargetOf;
}

const USER_TYPES = new Set(['user', 'created_by', 'updated_by']);

export async function buildFormulaRuntime(
    tx: Tx,
    tenantId: number,
    fields: readonly Field[],
    plans: readonly ThroughPlan[] = [],
    now: Date = new Date(),
): Promise<FormulaRuntime | undefined> {
    const formulas = fields.filter((f) => f.type === 'formula');
    if (formulas.length === 0) return undefined;
    const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const raw = ((row?.settings ?? {}) as Record<string, unknown>).format ?? {};
    const parsed = tenantFormatSchema.safeParse(raw);
    const format = parsed.success ? parsed.data : tenantFormatSchema.parse({});
    // Los nombres de las personas, sólo si alguna fórmula usa un campo persona.
    const byId = new Map(fields.map((f) => [f.id, f]));
    const needsUsers = formulas.some((f) => formulaDependencies(f.config).some((id) => USER_TYPES.has(byId.get(id)?.type ?? '')));
    const names = needsUsers ? await memberNames(tx, tenantId) : new Map<number, string>();
    const targets = new Map(plans.map((p) => [p.field.id, p.targetField]));
    return {
        env: {
            now,
            timeZone: format.timezone ?? FALLBACK_TIME_ZONE,
            numberFormat: format.number_format,
            dateFormat: format.date_format,
            timeFormat: format.time_format,
            userName: (id) => names.get(id) ?? null,
        },
        throughTarget: (id) => {
            const t = targets.get(id);
            return t ? { type: t.type, config: t.config } : null;
        },
    };
}

async function memberNames(tx: Tx, tenantId: number): Promise<Map<number, string>> {
    const rows = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, tenantId));
    return new Map(rows.map((u) => [u.id, (u.name ?? '').trim() || u.email]));
}

/**
 * Escribe en `data` el valor de cada fórmula de la fila (en su forma de
 * guardado: número, texto, `YYYY-MM-DD`, instante ISO o sí/no) y junta los
 * errores por `f{id}`. Una fórmula con error queda en null: «#ERROR» en la
 * celda con el motivo, sin tirar la lista.
 */
export function applyRowFormulas<T extends { data: Record<string, unknown> }>(
    fields: readonly Field[],
    row: T,
    rt: FormulaRuntime | undefined,
): T & { formulaErrors?: Record<string, string> } {
    if (!rt || !fields.some((f) => f.type === 'formula')) return row;
    const data = { ...row.data };
    const { values, errors } = evaluateRowFormulas(fields, (id) => data[jsonbKeyForField(id)] ?? null, rt.env, {
        throughTarget: rt.throughTarget,
    });
    for (const [id, value] of values) data[jsonbKeyForField(id)] = value;
    const formulaErrors: Record<string, string> = {};
    for (const [id, message] of errors) formulaErrors[jsonbKeyForField(id)] = message;
    return { ...row, data, ...(errors.size > 0 ? { formulaErrors } : {}) };
}
