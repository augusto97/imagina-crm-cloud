import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MeUserSummary } from '@imagina-base/shared';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { mentions } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { MeRepository, type MeUserRow } from './me.repository';

/** Tope duro de resultados del search (anti dump masivo de miembros). */
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 8;

@Injectable()
export class MeService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly repo: MeRepository,
    ) {}

    /**
     * Búsqueda de miembros del tenant activo por nombre o email (substring,
     * case-insensitive). Query vacío → [] sin tocar la DB: el endpoint no
     * soporta "todos los users" a propósito.
     */
    async searchUsers(tenantId: number, q: string, rawLimit?: number): Promise<MeUserSummary[]> {
        const needle = q.trim();
        if (needle === '') return [];
        const limit = clampLimit(rawLimit);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.searchMembers(tx, tenantId, needle, limit),
        );
        return rows.map(toSummary);
    }

    /** Lookup de un miembro del tenant activo por id — 404 si no es miembro. */
    async getUser(tenantId: number, userId: number): Promise<MeUserSummary> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findMember(tx, tenantId, userId),
        );
        if (!row) {
            throw new NotFoundException({
                code: 'user_not_found',
                message: `El usuario ${userId} no es miembro de este workspace`,
                data: { status: 404 },
            });
        }
        return toSummary(row);
    }

    getEmailSignature(userId: number): Promise<string> {
        return this.repo.getSignature(this.db, userId);
    }

    /** Últimas menciones del usuario en el tenant (RLS + índice por usuario). */
    async mentions(
        tenantId: number,
        userId: number,
        rawLimit: number,
    ): Promise<Array<Record<string, unknown>>> {
        const limit = Math.min(Math.max(Math.trunc(rawLimit) || 20, 1), 100);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(mentions)
                .where(and(eq(mentions.tenantId, tenantId), eq(mentions.mentionedUserId, userId)))
                .orderBy(desc(mentions.id))
                .limit(limit),
        );
        // Shape estilo activity (lo que consume el NotificationBell).
        return rows.map((m) => ({
            id: m.id,
            list_id: m.listId,
            record_id: m.recordId,
            user_id: m.authorUserId,
            action: 'comment_created',
            changes: { snippet: m.snippet },
            created_at: m.createdAt.toISOString(),
        }));
    }

    async updateEmailSignature(userId: number, signature: string): Promise<string> {
        await this.repo.setSignature(this.db, userId, signature);
        return signature;
    }
}

/** login = email y display_name = name (shape del picker heredado del plugin). */
function toSummary(row: MeUserRow): MeUserSummary {
    return { id: row.id, login: row.email, display_name: row.name, avatar_url: '' };
}

function clampLimit(raw?: number): number {
    if (raw === undefined || Number.isNaN(raw)) return DEFAULT_SEARCH_LIMIT;
    return Math.min(Math.max(Math.trunc(raw), 1), MAX_SEARCH_LIMIT);
}
