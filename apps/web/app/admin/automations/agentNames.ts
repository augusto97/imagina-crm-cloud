/**
 * E6 — Nombres de los agentes para los resúmenes («Le pide trabajo al agente
 * «Clasificador»»). Los registra el selector cuando carga las opciones; sin
 * ellos el resumen cae a «un agente de IA».
 *
 * Vive aparte de `automationMeta.ts` porque `useAiAgents` (que carga la ficha
 * del registro) sólo necesita registrarlos: importar `automationMeta` metía el
 * catálogo entero de pasos en la carga inicial de la app.
 */
const AGENT_NAMES = new Map<number, string>();

export function rememberAgentNames(agents: ReadonlyArray<{ id: number; name: string }>): void {
    for (const a of agents) AGENT_NAMES.set(a.id, a.name);
}

export function agentNameFor(id: number): string | null {
    return Number.isInteger(id) && id > 0 ? (AGENT_NAMES.get(id) ?? null) : null;
}
