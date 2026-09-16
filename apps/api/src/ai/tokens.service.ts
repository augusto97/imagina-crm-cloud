import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreatePersonalTokenInput, CreatedPersonalToken, PersonalToken, PersonalTokenScope, Role } from '@imagina-base/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DRIZZLE, type Db } from '../db/client';
import { memberships, oauthClients, personalAccessTokens, users } from '../db/schema';

/** Prefijo reconocible del secreto (como `ghp_` / `sk-ant-`): `ib_pat_`. */
export const TOKEN_PREFIX = 'ib_pat_';
/** Prefijo del refresh token OAuth (v0.1.184) — distinto para que nunca se confunda con uno de acceso. */
export const REFRESH_PREFIX = 'ib_rt_';
/** Cada cuánto se actualiza `last_used_at` como mucho (evita un UPDATE por request). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface IssuedOauthToken {
    token: PersonalToken;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

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
            .select({ row: personalAccessTokens, clientName: oauthClients.clientName })
            .from(personalAccessTokens)
            .leftJoin(oauthClients, eq(oauthClients.clientId, personalAccessTokens.clientId))
            .where(and(eq(personalAccessTokens.userId, userId), eq(personalAccessTokens.tenantId, tenantId), isNull(personalAccessTokens.revokedAt)))
            .orderBy(desc(personalAccessTokens.createdAt));
        return rows.map((r) => toDto(r.row, r.clientName));
    }

    /**
     * v0.1.184 — Emisión por OAuth ("Autorizar" desde claude.ai / Cursor):
     * misma fila que un token personal, pero con el cliente conectado y un
     * refresh token rotativo. El acceso dura poco (`accessTtlMs`) y se renueva
     * con `rotate`; el refresh vence a `refreshTtlMs` de la ÚLTIMA renovación.
     */
    async issueForClient(input: {
        userId: number;
        tenantId: number;
        scope: PersonalTokenScope;
        clientId: string;
        clientName: string;
        accessTtlMs: number;
        refreshTtlMs: number;
    }): Promise<IssuedOauthToken> {
        const access = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const refresh = `${REFRESH_PREFIX}${randomBytes(32).toString('base64url')}`;
        const now = Date.now();
        const [row] = await this.db
            .insert(personalAccessTokens)
            .values({
                userId: input.userId,
                tenantId: input.tenantId,
                name: input.clientName,
                prefix: access.slice(0, TOKEN_PREFIX.length + 6),
                tokenHash: hashToken(access),
                scope: input.scope,
                clientId: input.clientId,
                refreshTokenHash: hashToken(refresh),
                expiresAt: new Date(now + input.accessTtlMs),
                refreshExpiresAt: new Date(now + input.refreshTtlMs),
            })
            .returning();
        return { token: toDto(row!, input.clientName), accessToken: access, refreshToken: refresh, expiresIn: Math.floor(input.accessTtlMs / 1000) };
    }

    /**
     * Canje del refresh token: valida (vivo, no revocado, del mismo cliente),
     * ROTA los dos secretos en la misma fila (el refresh viejo muere al
     * instante — si alguien lo robó y lo usa después, falla) y devuelve el par
     * nuevo. `null` = inválido, sin distinguir por qué.
     */
    async rotate(refreshSecret: string, clientId: string, accessTtlMs: number, refreshTtlMs: number): Promise<IssuedOauthToken | null> {
        if (!refreshSecret.startsWith(REFRESH_PREFIX) || refreshSecret.length > 200) return null;
        const [row] = await this.db
            .select({ row: personalAccessTokens, clientName: oauthClients.clientName, disabledAt: users.disabledAt })
            .from(personalAccessTokens)
            .innerJoin(users, eq(users.id, personalAccessTokens.userId))
            .leftJoin(oauthClients, eq(oauthClients.clientId, personalAccessTokens.clientId))
            .where(eq(personalAccessTokens.refreshTokenHash, hashToken(refreshSecret)))
            .limit(1);
        if (!row || row.row.revokedAt || row.disabledAt || row.row.clientId !== clientId) return null;
        if (!row.row.refreshExpiresAt || row.row.refreshExpiresAt.getTime() < Date.now()) return null;
        const access = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
        const refresh = `${REFRESH_PREFIX}${randomBytes(32).toString('base64url')}`;
        const now = Date.now();
        const [updated] = await this.db
            .update(personalAccessTokens)
            .set({
                prefix: access.slice(0, TOKEN_PREFIX.length + 6),
                tokenHash: hashToken(access),
                refreshTokenHash: hashToken(refresh),
                expiresAt: new Date(now + accessTtlMs),
                refreshExpiresAt: new Date(now + refreshTtlMs),
            })
            // El WHERE repite el hash viejo: dos canjes concurrentes del mismo
            // refresh → sólo uno gana (el otro no matchea ninguna fila).
            .where(and(eq(personalAccessTokens.id, row.row.id), eq(personalAccessTokens.refreshTokenHash, hashToken(refreshSecret))))
            .returning();
        if (!updated) return null;
        return { token: toDto(updated, row.clientName), accessToken: access, refreshToken: refresh, expiresIn: Math.floor(accessTtlMs / 1000) };
    }

    /** RFC 7009: revoca por el secreto de acceso O el de refresh. Silencioso si no existe. */
    async revokeBySecret(secret: string, clientId: string): Promise<boolean> {
        if (secret.length > 200) return false;
        const hash = hashToken(secret);
        const where = secret.startsWith(REFRESH_PREFIX) ? eq(personalAccessTokens.refreshTokenHash, hash) : eq(personalAccessTokens.tokenHash, hash);
        const rows = await this.db
            .update(personalAccessTokens)
            .set({ revokedAt: new Date() })
            .where(and(where, eq(personalAccessTokens.clientId, clientId), isNull(personalAccessTokens.revokedAt)))
            .returning({ id: personalAccessTokens.id });
        return rows.length > 0;
    }

    async create(userId: number, tenantId: number, input: CreatePersonalTokenInput, role: Role): Promise<CreatedPersonalToken> {
        assertNotClient(role);
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
        // v0.1.185 — el rol `client` (portal) es "solo portal": aunque una
        // fila existiera, jamás entra al MCP (defensa en profundidad del
        // bloqueo de crear/autorizar).
        if (row.role === 'client') return null;
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

/**
 * v0.1.185 — El rol `client` es el usuario del PORTAL: sólo ve su registro
 * por magic link. Un token (pegado u OAuth) le daría `list_lists` /
 * `get_list_schema`, que no filtran por rol → vería nombres y campos de
 * TODAS las listas de la empresa. Se rechaza en la puerta.
 */
export function assertNotClient(role: Role): void {
    if (role === 'client') {
        throw new ForbiddenException({ code: 'client_role_not_allowed', message: 'El acceso por MCP es para miembros del equipo, no para usuarios del portal', data: { status: 403 } });
    }
}

export function hashToken(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function toDto(r: typeof personalAccessTokens.$inferSelect, clientName: string | null = null): PersonalToken {
    return {
        client_name: r.clientId ? clientName ?? r.name : null,
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
