import { BadRequestException } from '@nestjs/common';
import { agentIdsInActions } from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { aiAgentLists, aiAgents } from '../db/schema';

/**
 * E6 — Los agentes de IA que nombra una automatización («Pedirle a un agente»,
 * también en ramas y bucles) tienen que existir en la empresa y trabajar en
 * ESTA lista (400 legible si no): un id de otra empresa no se guarda.
 */
export async function assertAgentRefs(tx: Tx, tenantId: number, listId: number, actions: unknown): Promise<void> {
    const refs = agentIdsInActions(actions);
    if (refs.length === 0) return;
    const rows = await tx
        .select({ id: aiAgents.id, name: aiAgents.name, listId: aiAgentLists.listId })
        .from(aiAgents)
        .leftJoin(aiAgentLists, and(eq(aiAgentLists.agentId, aiAgents.id), eq(aiAgentLists.listId, listId)))
        .where(and(eq(aiAgents.tenantId, tenantId), inArray(aiAgents.id, refs)));
    const found = new Map(rows.map((r) => [r.id, r]));
    const missing = refs.filter((id) => !found.has(id));
    if (missing.length > 0) {
        throw new BadRequestException({
            code: 'invalid_agent_ref',
            message: `El agente de IA elegido no existe (#${missing.join(', #')}): elige otro en el editor.`,
            data: { status: 400, errors: { agent_id: 'No existe' } },
        });
    }
    const outside = rows.filter((r) => r.listId === null);
    if (outside.length > 0) {
        throw new BadRequestException({
            code: 'invalid_agent_ref',
            message: `El agente «${outside[0]!.name}» no trabaja en esta lista: agrégala a sus listas primero.`,
            data: { status: 400, errors: { agent_id: 'No trabaja en esta lista' } },
        });
    }
}
