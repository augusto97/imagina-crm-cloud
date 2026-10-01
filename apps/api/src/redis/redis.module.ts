import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { attachDiagnostics } from '../observability/diagnostics';
import { guardRedis } from './redis.util';

export const REDIS = Symbol('REDIS');

const logger = new Logger('RedisModule');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    async onApplicationShutdown(): Promise<void> {
        await this.redis.quit();
    }
}

@Global()
@Module({
    providers: [
        {
            provide: REDIS,
            useFactory: (env: Env) => {
                const client = guardRedis(new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }), logger, 'core');
                // v0.1.238 — el registro de diagnóstico (Plataforma → Diagnóstico).
                attachDiagnostics(client);
                return client;
            },
            inject: [ENV],
        },
        RedisLifecycle,
    ],
    exports: [REDIS],
})
export class RedisModule {}
