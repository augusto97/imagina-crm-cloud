import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

export interface SessionData {
    userId: number;
    createdAt: string;
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
        return JSON.parse(raw) as SessionData;
    }

    async destroy(token: string): Promise<void> {
        await this.redis.del(this.key(token));
    }
}
