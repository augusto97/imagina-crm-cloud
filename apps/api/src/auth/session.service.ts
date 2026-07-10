import { randomBytes } from 'node:crypto';
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

    async create(userId: number): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const data: SessionData = { userId, createdAt: new Date().toISOString() };
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

    async destroy(token: string): Promise<void> {
        await this.redis.del(this.key(token));
    }
}
