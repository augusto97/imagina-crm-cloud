import { computedToFormula } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';

/**
 * Fórmulas (A1) — «Convertir en fórmula» arranca con la fórmula equivalente
 * al calculado, para revisarla. Aparte del editor para que cambiar el tipo
 * no tenga que cargar el editor completo.
 */
export function formulaConfigFromComputed(computedConfig: Record<string, unknown>, fields: FieldEntity[]): Record<string, unknown> {
    const formula = computedToFormula(computedConfig, fields);
    return formula ? { formula } : {};
}
