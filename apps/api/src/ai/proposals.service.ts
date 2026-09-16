import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { roleHasCapability, type AiProposal } from '@imagina-base/shared';
import { AuditService } from '../audit/audit.service';
import { ConversationsStore } from './conversations.store';
import { ProposalsStore } from './proposals.store';
import { DataTools } from './tools/data-tools';
import { StructureTools } from './tools/structure-tools';
import type { AiToolContext } from './tools/registry';

/**
 * Aplicar una propuesta del asistente (ADR-S21). Es el ÚNICO punto por el
 * que una conversación termina escribiendo algo, y corre como la persona:
 * misma empresa, mismo usuario, misma capability que exigiría el botón de la
 * interfaz (se re-chequea acá aunque ya se chequeó al proponer — el rol
 * pudo cambiar entre medio). Queda en la bitácora con el título legible.
 */
@Injectable()
export class ProposalsService {
    constructor(
        private readonly store: ProposalsStore,
        private readonly conversations: ConversationsStore,
        private readonly structure: StructureTools,
        private readonly audit: AuditService,
        // Fase 2 — herramientas de datos (opcional para los specs que arman el service a mano).
        @Optional() private readonly data?: DataTools,
    ) {}

    async get(ctx: AiToolContext, id: string): Promise<AiProposal> {
        const stored = await this.store.get(ctx.tenantId, id);
        if (!stored || stored.userId !== ctx.userId) throw notFound(id);
        return stored.proposal;
    }

    async apply(ctx: AiToolContext, id: string): Promise<AiProposal> {
        const stored = await this.store.get(ctx.tenantId, id);
        // Sólo quien la pidió puede aplicarla (la conversación es suya).
        if (!stored || stored.userId !== ctx.userId) throw notFound(id);
        if (stored.proposal.applied) {
            throw new ConflictException({ code: 'ai_proposal_applied', message: 'Esta propuesta ya se aplicó', data: { status: 409 } });
        }
        if (stored.capability && !roleHasCapability(ctx.role, stored.capability)) {
            throw new ForbiddenException({
                code: 'ai_proposal_forbidden',
                message: `Tu rol no tiene permiso para aplicar esta propuesta (requiere ${stored.capability})`,
                data: { status: 403 },
            });
        }
        const applier = DataTools.KINDS.has(stored.kind) ? this.data : this.structure;
        if (!applier) throw new NotFoundException({ code: 'ai_proposal_not_found', message: 'Tipo de propuesta no disponible', data: { status: 404 } });
        const outcome = await applier.apply(ctx, stored);
        const applied: AiProposal = {
            ...stored.proposal,
            applied: true,
            result: { message: outcome.message, links: outcome.links, warnings: outcome.warnings },
        };
        await this.store.save({ ...stored, proposal: applied });
        if (stored.conversationId) {
            await this.conversations.markProposal(ctx.tenantId, ctx.userId, stored.conversationId, applied);
        }
        await this.audit.log({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'ai.apply',
            targetType: 'ai_proposal',
            targetLabel: applied.title,
            meta: { kind: applied.kind, proposal_id: applied.id, list_slug: applied.list_slug, warnings: outcome.warnings.length },
        });
        return applied;
    }
}

function notFound(id: string): NotFoundException {
    return new NotFoundException({
        code: 'ai_proposal_not_found',
        message: `La propuesta ${id} no existe o venció (las propuestas duran 2 horas)`,
        data: { status: 404 },
    });
}
