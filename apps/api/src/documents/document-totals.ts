/**
 * v0.1.266 (ADR-S35) — Las filas del bloque «Totales» de un documento.
 *
 * v0.1.290 — El cálculo se mudó a `packages/shared` (`document-calc.ts`),
 * junto con las columnas calculadas de la tabla de ítems: son el contrato
 * del documento y se prueban sin base de datos. Aquí queda el re-export para
 * los llamadores de siempre.
 */
export { computeDesignTotals, computeTotalRows, type ComputedTotalRow, type TotalsSources } from '@imagina-base/shared';
