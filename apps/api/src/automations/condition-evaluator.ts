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
