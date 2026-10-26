import { clampAiEffort, type AiEffort, type AiModelCaps } from '@imagina-base/shared';

/**
 * Cómo se le pide a cada modelo que piense (ADR-S60). Se decide por lo que el
 * modelo DECLARA que soporta (catálogo del proveedor), no por su nombre: así
 * un modelo nuevo funciona el día que aparece. Los modelos actuales sólo
 * aceptan pensamiento adaptativo (un presupuesto fijo los hace fallar con
 * 400); los anteriores, sólo presupuesto fijo.
 */

/**
 * Asistente: pensamiento adaptativo con el esfuerzo que eligió la plataforma
 * (o la empresa con su clave; ADR-S61). Por defecto `medium`: resuelve
 * pedidos de estructura, no problemas abiertos, y la latencia importa. El
 * nivel se ajusta a lo que el modelo acepta (`clampAiEffort`).
 */
export function assistantModelParams(caps: AiModelCaps, effort: AiEffort | null): Record<string, unknown> {
    const level = effort ? effortParam(effort, caps) : {};
    if (caps.adaptive_thinking) return { thinking: { type: 'adaptive' }, ...level };
    if (caps.budget_thinking) return { thinking: { type: 'enabled', budget_tokens: 2048 } };
    return level;
}

/** `output_config.effort` con el nivel más cercano que acepte el modelo, o nada si no usa esfuerzo. */
export function effortParam(wanted: AiEffort, caps: AiModelCaps): Record<string, unknown> {
    const effort = clampAiEffort(wanted, caps);
    return effort ? { output_config: { effort } } : {};
}

/**
 * Tope de salida del asistente. El pensamiento cuenta dentro del tope, y con
 * más esfuerzo piensa más: con el mismo tope que en `medium` una propuesta
 * grande (la ficha, un correo) quedaría cortada.
 */
export function assistantMaxTokens(effort: AiEffort | null): number {
    if (effort === 'max' || effort === 'xhigh') return 32_000;
    if (effort === 'high') return 24_000;
    return 16_000;
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
            extra: effortParam('low', caps),
        };
    }
    return { max_tokens: answerTokens, extra: {} };
}
