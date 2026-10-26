import type { AiModelCaps } from '@imagina-base/shared';

/**
 * Cómo se le pide a cada modelo que piense (ADR-S60). Se decide por lo que el
 * modelo DECLARA que soporta (catálogo del proveedor), no por su nombre: así
 * un modelo nuevo funciona el día que aparece. Los modelos actuales sólo
 * aceptan pensamiento adaptativo (un presupuesto fijo los hace fallar con
 * 400); los anteriores, sólo presupuesto fijo.
 */

/**
 * Asistente: pensamiento adaptativo con esfuerzo `medium` — resuelve pedidos
 * de estructura, no problemas abiertos; la latencia importa más que exprimirlo.
 */
export function assistantModelParams(caps: AiModelCaps): Record<string, unknown> {
    const effort = caps.effort ? { output_config: { effort: 'medium' } } : {};
    if (caps.adaptive_thinking) return { thinking: { type: 'adaptive' }, ...effort };
    if (caps.budget_thinking) return { thinking: { type: 'enabled', budget_tokens: 2048 } };
    return effort;
}

/** Margen para el pensamiento en los modelos donde no se puede apagar (cuenta dentro de `max_tokens`). */
export const FIELD_THINKING_HEADROOM = 3000;

/**
 * Campos con IA: una respuesta corta por registro. No se pide pensamiento;
 * en los modelos que piensan igual (no se puede apagar) se baja el esfuerzo
 * al mínimo y se deja margen en `max_tokens`, porque el pensamiento cuenta
 * dentro del tope y con 300 tokens la respuesta quedaría vacía.
 */
export function fieldModelParams(caps: AiModelCaps, answerTokens: number): { max_tokens: number; extra: Record<string, unknown> } {
    if (caps.adaptive_thinking) {
        return {
            max_tokens: answerTokens + FIELD_THINKING_HEADROOM,
            extra: caps.effort ? { output_config: { effort: 'low' } } : {},
        };
    }
    return { max_tokens: answerTokens, extra: {} };
}
