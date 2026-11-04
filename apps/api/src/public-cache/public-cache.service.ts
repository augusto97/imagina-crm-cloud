import { randomBytes } from 'node:crypto';
import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { guardRedis } from '../redis/redis.util';
import { PublicCache } from './public-cache';

/** Canal por el que un servidor le avisa a los demás qué dejó de valer. */
const CHANNEL = 'imb:public-cache';

interface InvalidationMessage {
    op: 'key' | 'prefix' | 'bump';
    key: string;
    node: string;
}

/**
 * v0.1.352 (ADR-S95) — La caché de lo público para toda la API. Con varios
 * servidores, invalidar en uno avisa a los demás por Redis (pub/sub); si Redis
 * no está, cada servidor sigue con su caché y lo cambiado se ve al vencer
 * (segundos). Nunca frena una invalidación ni una lectura.
 */
@Injectable()
export class PublicCacheService extends PublicCache implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(PublicCacheService.name);
    private readonly node = randomBytes(8).toString('hex');
    private subscriber: IORedis | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(REDIS) private readonly redis: Redis,
    ) {
        super({ maxEntries: 5000, concurrency: env.PUBLIC_DB_CONCURRENCY, maxQueue: 400, queueTimeoutMs: 8000 });
    }

    async onModuleInit(): Promise<void> {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const sub = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true }), this.logger, 'public-cache');
            sub.on('message', (_channel: string, raw: string) => this.onMessage(raw));
            await sub.connect();
            await sub.subscribe(CHANNEL);
            this.subscriber = sub;
        } catch (err) {
            this.logger.warn(`Avisos de caché entre servidores apagados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.subscriber?.quit().catch(() => undefined);
    }

    override invalidate(key: string): void {
        super.invalidate(key);
        this.broadcast({ op: 'key', key, node: this.node });
    }

    override invalidatePrefix(prefix: string): void {
        super.invalidatePrefix(prefix);
        this.broadcast({ op: 'prefix', key: prefix, node: this.node });
    }

    override bump(ns: string): void {
        super.bump(ns);
        this.broadcast({ op: 'bump', key: ns, node: this.node });
    }

    private broadcast(msg: InvalidationMessage): void {
        if (this.env.NODE_ENV === 'test') return;
        void this.redis.publish(CHANNEL, JSON.stringify(msg)).catch(() => undefined);
    }

    private onMessage(raw: string): void {
        let msg: InvalidationMessage;
        try {
            msg = JSON.parse(raw) as InvalidationMessage;
        } catch {
            return;
        }
        if (!msg || msg.node === this.node || typeof msg.key !== 'string') return;
        // Sólo local: el aviso no se vuelve a reenviar.
        if (msg.op === 'prefix') super.invalidatePrefix(msg.key);
        else if (msg.op === 'bump') super.bump(msg.key);
        else super.invalidate(msg.key);
    }
}

@Global()
@Module({ providers: [PublicCacheService], exports: [PublicCacheService] })
export class PublicCacheModule {}
