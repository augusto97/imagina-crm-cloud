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

    async create(userId: number): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        const data: SessionData = { userId, createdAt: new Date().toISOString() };
        await this.redis.set(this.key(token), JSON.stringify(data), 'EX', this.env.SESSION_TTL_SECONDS);
        return token;
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
