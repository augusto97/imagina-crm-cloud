import { evaluateConditionOp, type ConditionData, type ConditionOptions } from '@imagina-base/shared';

/**
 * Evaluador de condiciones de las automatizaciones (trigger filter / condición
 * por acción / rama de if_else) contra los valores de un registro, por SLUG.
 *
 * v0.1.287 — la implementación vive en `packages/shared` (`evaluateCondition`):
 * la misma definición evalúa los colores condicionales de la tabla en el
 * navegador, así «es», «contiene» o «este mes» significan lo mismo en las dos
 * puntas. Aquí sólo se re-exporta para no tocar a quienes la importan.
 */
export { evaluateCondition, type ConditionOptions } from '@imagina-base/shared';

/** v0.1.288 — una regla evaluada (lo que muestra «Probar»: POR QUÉ sí o no). */
export interface ConditionRuleCheck {
    field: string;
    op: string;
    expected: unknown;
    actual: unknown;
    ok: boolean;
}

/**
 * v0.1.288 — La misma evaluación que `evaluateCondition`, regla por regla
 * (comparte `evaluateConditionOp`: lo que explica «Probar» es exactamente lo
 * que decide el motor). `matched` es el resultado AND.
 */
export function explainCondition(
    condition: ConditionData | null | undefined,
    fieldValue: (slug: string) => unknown,
    opts: ConditionOptions = {},
): { matched: boolean; checks: ConditionRuleCheck[] } {
    const checks: ConditionRuleCheck[] = [];
    if (condition === null || condition === undefined) return { matched: true, checks };
    if (Array.isArray(condition)) {
        for (const rule of condition) {
            if (!rule || typeof rule !== 'object') continue;
            const field = String((rule as { field?: unknown; slug?: unknown }).field ?? (rule as { slug?: unknown }).slug ?? '');
            const op = String((rule as { op?: unknown }).op ?? 'eq');
            const expected = (rule as { value?: unknown }).value ?? null;
            const actual = field === '' ? undefined : fieldValue(field);
            checks.push({ field, op, expected, actual, ok: field !== '' && evaluateConditionOp(actual, op, expected, opts) });
        }
    } else {
        for (const [slug, expected] of Object.entries(condition)) {
            if (slug === '') continue;
            const actual = fieldValue(slug);
            checks.push({ field: slug, op: 'eq', expected, actual, ok: evaluateConditionOp(actual, 'eq', expected, opts) });
        }
    }
    return { matched: checks.every((c) => c.ok), checks };
}
