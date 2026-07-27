import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

export interface SessionData {
    userId: number;
    createdAt: string;
    /** Impersonación (ADR-S15 F5): userId del operador que impersona. */
    impersonatedBy?: number;
    /** Token de la sesión original del operador (para volver al salir). */
    origToken?: string;
    /** Tope duro de la impersonación (ISO); pasada esta fecha la sesión muere. */
    expiresAt?: string;
    /** Fila de `impersonation_log` para marcar el cierre. */
    auditId?: number;
    /** v0.1.116 — contexto del dispositivo, para el panel de sesiones activas. */
    userAgent?: string;
    ip?: string;
}

/** Sesión activa tal como la ve el dueño de la cuenta (nunca expone el token). */
export interface ActiveSession {
    /** Id PÚBLICO: hash del token. El token es la credencial y no sale nunca. */
    id: string;
    created_at: string;
    /** Aproximado a partir del TTL restante (el TTL es deslizante). */
    last_seen_at: string;
    user_agent: string;
    ip: string;
    current: boolean;
    impersonated: boolean;
}

/**
 * Sesiones opacas en Redis (STANDALONE.md §5): revocación instantánea,
 * sin JWT stateless. TTL deslizante — cada lectura renueva la expiración.
 */
@Injectable()
export class SessionService {
    constructor(
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    private key(token: string): string {
        return `sess:${token}`;
    }

    /** Índice inverso userId → tokens, para revocar TODAS sus sesiones (desactivación). */
    private userKey(userId: number): string {
        return `usess:${userId}`;
    }

    /** Id público de una sesión (para listarla/revocarla sin exponer el token). */
    private publicId(token: string): string {
        return createHash('sha256').update(token).digest('hex').slice(0, 16);
    }

    async create(userId: number, meta: { userAgent?: string; ip?: string } = {}): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const data: SessionData = {
            userId,
            createdAt: new Date().toISOString(),
            userAgent: (meta.userAgent ?? '').slice(0, 200),
            ip: (meta.ip ?? '').slice(0, 60),
        };
        await this.redis.set(this.key(token), JSON.stringify(data), 'EX', this.env.SESSION_TTL_SECONDS);
        // Registrar el token en el set del usuario (para revocación masiva). El
        // set vive un poco más que la sesión; los tokens ya expirados se limpian
        // solos al revocar (del es no-op).
        await this.redis.sadd(this.userKey(userId), token);
        await this.redis.expire(this.userKey(userId), this.env.SESSION_TTL_SECONDS * 2);
        return token;
    }

    /** Revoca TODAS las sesiones de un usuario (al desactivar la cuenta). */
    async destroyAllForUser(userId: number): Promise<void> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        if (tokens.length > 0) {
            await this.redis.del(...tokens.map((t) => this.key(t)));
        }
        await this.redis.del(this.userKey(userId));
    }

    async get(token: string): Promise<SessionData | null> {
        const raw = await this.redis.getex(this.key(token), 'EX', this.env.SESSION_TTL_SECONDS);
        if (!raw) {
            return null;
        }
        const data = JSON.parse(raw) as SessionData;
        // Tope duro de impersonación: aunque getex renueve el TTL de Redis, una
        // sesión impersonada muere pasada su `expiresAt`.
        if (data.expiresAt && Date.parse(data.expiresAt) < Date.now()) {
            await this.destroy(token);
            return null;
        }
        return data;
    }

    /**
     * Crea una sesión de IMPERSONACIÓN (operador → usuario objetivo). TTL corto
     * y tope duro `expiresAt`. Guarda el token original del operador para poder
     * volver, y el id de la fila de auditoría para cerrarla al salir.
     */
    async createImpersonation(params: {
        targetUserId: number;
        operatorId: number;
        origToken: string;
        auditId: number;
        ttlSeconds: number;
    }): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const data: SessionData = {
            userId: params.targetUserId,
            createdAt: new Date().toISOString(),
            impersonatedBy: params.operatorId,
            origToken: params.origToken,
            expiresAt: new Date(Date.now() + params.ttlSeconds * 1000).toISOString(),
            auditId: params.auditId,
        };
        await this.redis.set(this.key(token), JSON.stringify(data), 'EX', params.ttlSeconds);
        // Bajo el índice del OBJETIVO: si lo desactivan, también cae la impersonación.
        await this.redis.sadd(this.userKey(params.targetUserId), token);
        await this.redis.expire(this.userKey(params.targetUserId), params.ttlSeconds);
        return token;
    }

    /**
     * v0.1.116 — Sesiones activas del usuario (panel "Dispositivos").
     *
     * El `last_seen` se DERIVA del TTL restante: como el TTL es deslizante (se
     * renueva en cada request autenticada), `ttl` dice cuánto hace que no se
     * usa, sin tener que escribir en Redis en cada request.
     */
    async listForUser(userId: number, currentToken: string): Promise<ActiveSession[]> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        if (tokens.length === 0) return [];
        // UN pipeline en vez de 2 round-trips por sesión: una cuenta con
        // muchas sesiones abiertas (el índice inverso las acumula hasta que
        // expiran) hacía cientos de idas y vueltas a Redis por request.
        const pipeline = this.redis.pipeline();
        for (const token of tokens) {
            pipeline.get(this.key(token));
            pipeline.ttl(this.key(token));
        }
        const replies = (await pipeline.exec()) ?? [];

        const out: ActiveSession[] = [];
        const stale: string[] = [];
        for (const [i, token] of tokens.entries()) {
            const raw = replies[i * 2]?.[1] as string | null | undefined;
            const ttl = Number(replies[i * 2 + 1]?.[1] ?? -1);
            if (!raw) {
                stale.push(token);
                continue;
            }
            const data = JSON.parse(raw) as SessionData;
            const idleSeconds = Math.max(0, this.env.SESSION_TTL_SECONDS - Math.max(ttl, 0));
            out.push({
                id: this.publicId(token),
                created_at: data.createdAt,
                last_seen_at: new Date(Date.now() - idleSeconds * 1000).toISOString(),
                user_agent: data.userAgent ?? '',
                ip: data.ip ?? '',
                current: token === currentToken,
                impersonated: data.impersonatedBy !== undefined,
            });
        }
        // Limpieza oportunista del índice inverso (tokens ya expirados).
        if (stale.length > 0) await this.redis.srem(this.userKey(userId), ...stale);
        return out.sort((a, b) => (a.current ? -1 : b.current ? 1 : b.last_seen_at.localeCompare(a.last_seen_at)));
    }

    /** Revoca UNA sesión del usuario por su id público. `false` si no existe. */
    async destroyOneForUser(userId: number, publicId: string): Promise<boolean> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        const match = tokens.find((t) => this.publicId(t) === publicId);
        if (!match) return false;
        await this.redis.del(this.key(match));
        await this.redis.srem(this.userKey(userId), match);
        return true;
    }

    /** Cierra todas MENOS la actual ("cerrar sesión en los otros dispositivos"). */
    async destroyOthersForUser(userId: number, keepToken: string): Promise<number> {
        const tokens = await this.redis.smembers(this.userKey(userId));
        const others = tokens.filter((t) => t !== keepToken);
        if (others.length === 0) return 0;
        await this.redis.del(...others.map((t) => this.key(t)));
        await this.redis.srem(this.userKey(userId), ...others);
        return others.length;
    }

    async destroy(token: string): Promise<void> {
        await this.redis.del(this.key(token));
    }
}
