import { Inject, Injectable } from '@nestjs/common';
import type { AiProposal, AiProposalKind, Capability } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import type { AiToolContext } from './tools/registry';

/** Vida de una propuesta sin aplicar. Después hay que volver a pedirla. */
export const PROPOSAL_TTL_SECONDS = 2 * 60 * 60;

/**
 * Lo que se guarda por propuesta: la tarjeta que ve la persona (`proposal`)
 * + el `payload` YA RESUELTO (ids reales, config validada) que el applier
 * ejecuta. El payload nunca sale al cliente: la UI dibuja la preview y el
 * servidor aplica lo que validó al proponer, no lo que le manden después.
 */
export interface StoredProposal {
    proposal: AiProposal;
    kind: AiProposalKind;
    payload: unknown;
    tenantId: number;
    userId: number;
    /** Capability que exige aplicarla (se re-chequea al aplicar). */
    capability: Capability | null;
    conversationId: string | null;
}

export interface AiApplyOutcome {
    message: string;
    links: Array<{ label: string; href: string }>;
    warnings: string[];
}

/** Quien sabe EJECUTAR una propuesta por `kind` (StructureTools en fase 1). */
export interface AiProposalApplier {
    apply(ctx: AiToolContext, stored: StoredProposal): Promise<AiApplyOutcome>;
}

@Injectable()
export class ProposalsStore {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    private key(tenantId: number, id: string): string {
        return `aiprop:${tenantId}:${id}`;
    }

    async save(stored: StoredProposal): Promise<void> {
        await this.redis.set(this.key(stored.tenantId, stored.proposal.id), JSON.stringify(stored), 'EX', PROPOSAL_TTL_SECONDS);
    }

    async get(tenantId: number, id: string): Promise<StoredProposal | null> {
        if (!/^[a-z0-9_-]{6,64}$/i.test(id)) return null;
        const raw = await this.redis.get(this.key(tenantId, id));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StoredProposal;
        } catch {
            return null;
        }
    }
}
