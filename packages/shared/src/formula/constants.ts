/**
 * Fórmulas (A1) — constantes livianas. Viven aparte del motor para que el
 * schema de campos (que carga toda la app) no arrastre el lector ni el
 * evaluador: esos se cargan sólo donde se usan.
 */

/** Largo máximo de una fórmula (caracteres). */
export const FORMULA_MAX_LENGTH = 4000;

/** Cómo se MUESTRA el resultado (elegido o inferido). */
export const FORMULA_RESULT_TYPES = ['number', 'currency', 'percent', 'duration', 'text', 'date', 'datetime', 'checkbox'] as const;
export type FormulaResultType = (typeof FORMULA_RESULT_TYPES)[number];
