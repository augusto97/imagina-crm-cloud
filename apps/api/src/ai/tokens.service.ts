import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreatePersonalTokenInput, CreatedPersonalToken, PersonalToken, PersonalTokenScope, Role } from '@imagina-base/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, personalAccessTokens, users } from '../db/schema';

/** Prefijo reconocible del secreto (como `ghp_` / `sk-ant-`): `ib_pat_`. */
export const TOKEN_PREFIX = 'ib_pat_';
/** Cada cuánto se actualiza `last_used_at` como mucho (evita un UPDATE por request). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ResolvedToken {
    tokenId: number;
    userId: number;
    tenantId: number;
    role: Role;
    scope: PersonalTokenScope;
}

/**
 * Tokens de acceso personal (ADR-S21 fase 3): la credencial del servidor
 * MCP. El secreto se genera acá, se devuelve UNA vez y sólo se guarda su
 * SHA-256; resolverlo hace UNA query (hash → token + membresía + usuario) y
 * falla cerrado si el token venció, fue revocado, la persona ya no es
 * miembro o su cuenta está desactivada.
 */
@Injectable()
export class PersonalTokensService {
    private readonly touched = new Map<number, number>();

    constructor(@Inject(DRIZZLE) private readonly db: Db) {}

    async list(userId: number, tenantId: number): Promise<PersonalToken[]> {
        const rows = await this.db
            .select()
            .from(personalAccessTokens)
            .where(and(eq(personalAccessTokens.userId, userId), eq(personalAccessTokens.tenantId, tenantId), isNull(personalAccessTokens.revokedAt)))
            .orderBy(desc(personalAccessTokens.createdAt));
        return rows.map(toDto);
    }

    async create(userId: number, tenantId: number, input: CreatePersonalTokenInput): Promise<CreatedPersonalToken> {
        const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const expiresAt = input.expires_in_days === null ? null : new Date(Date.now() + input.expires_in_days * 86_400_000);
        const [row] = await this.db
            .insert(personalAccessTokens)
            .values({
                userId,
                tenantId,
                name: input.name,
                prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
                tokenHash: hashToken(secret),
                scope: input.scope,
                expiresAt,
            })
            .returning();
        return { token: toDto(row!), secret };
    }

    async revoke(userId: number, tenantId: number, id: number): Promise<PersonalToken> {
        const [row] = await this.db
            .update(personalAccessTokens)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(personalAccessTokens.id, id),
                    eq(personalAccessTokens.userId, userId),
                    eq(personalAccessTokens.tenantId, tenantId),
                    isNull(personalAccessTokens.revokedAt),
                ),
            )
            .returning();
        if (!row) throw new NotFoundException({ code: 'token_not_found', message: 'El token no existe o ya fue revocado', data: { status: 404 } });
        return toDto(row);
    }

    /** Secreto → quién es y qué puede. `null` = credencial inválida (sin distinguir por qué). */
    async resolve(secret: string): Promise<ResolvedToken | null> {
        if (!secret.startsWith(TOKEN_PREFIX) || secret.length < TOKEN_PREFIX.length + 20 || secret.length > 200) return null;
        const [row] = await this.db
            .select({
                id: personalAccessTokens.id,
                userId: personalAccessTokens.userId,
                tenantId: personalAccessTokens.tenantId,
                scope: personalAccessTokens.scope,
                expiresAt: personalAccessTokens.expiresAt,
                revokedAt: personalAccessTokens.revokedAt,
                role: memberships.role,
                disabledAt: users.disabledAt,
            })
            .from(personalAccessTokens)
            .innerJoin(users, eq(users.id, personalAccessTokens.userId))
            .leftJoin(
                memberships,
                and(eq(memberships.userId, personalAccessTokens.userId), eq(memberships.tenantId, personalAccessTokens.tenantId)),
            )
            .where(eq(personalAccessTokens.tokenHash, hashToken(secret)))
            .limit(1);
        if (!row || row.revokedAt || row.disabledAt || !row.role) return null;
        if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
        void this.touch(row.id);
        return { tokenId: row.id, userId: row.userId, tenantId: row.tenantId, role: row.role as Role, scope: row.scope as PersonalTokenScope };
    }

    private async touch(id: number): Promise<void> {
        const last = this.touched.get(id) ?? 0;
        if (Date.now() - last < TOUCH_INTERVAL_MS) return;
        this.touched.set(id, Date.now());
        await this.db.update(personalAccessTokens).set({ lastUsedAt: new Date() }).where(eq(personalAccessTokens.id, id)).catch(() => undefined);
    }
}

export function hashToken(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function toDto(r: typeof personalAccessTokens.$inferSelect): PersonalToken {
    return {
        id: r.id,
        name: r.name,
        prefix: `${r.prefix}…`,
        scope: r.scope as PersonalTokenScope,
        tenant_id: r.tenantId,
        created_at: r.createdAt.toISOString(),
        last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
        expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    };
}
