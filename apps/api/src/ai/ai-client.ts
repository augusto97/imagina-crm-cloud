import Anthropic from '@anthropic-ai/sdk';

/**
 * Cliente del proveedor, inyectable para testear con un fake (los tests NO
 * hablan con la API real). En producción es el SDK oficial.
 *
 * v0.1.460 — vive aparte de `assistant.service.ts` (que lo re-exporta) para
 * que quien sólo necesita el cliente —el paso «Preguntarle a la IA» de las
 * automatizaciones— no arrastre el registro de herramientas del asistente.
 */
export type AiClientFactory = (apiKey: string) => Pick<Anthropic, 'messages'>;
export const AI_CLIENT_FACTORY = Symbol('AI_CLIENT_FACTORY');
export const defaultClientFactory: AiClientFactory = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
