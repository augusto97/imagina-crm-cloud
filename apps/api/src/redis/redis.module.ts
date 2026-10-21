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

/**
 * El cliente Redis PRINCIPAL (sesiones, caches, frenos): con tope por comando
 * (`commandTimeout`) para que un Redis colgado haga FALLAR los pedidos en vez
 * de dejarlos esperando para siempre. NO es para BullMQ (necesita comandos
 * bloqueantes y `maxRetriesPerRequest: null`: cada cola abre los suyos).
 */
export function createCoreRedis(url: string, commandTimeoutMs: number): Redis {
    return guardRedis(new Redis(url, { maxRetriesPerRequest: 3, commandTimeout: commandTimeoutMs }), logger, 'core');
}

@Global()
@Module({
    providers: [
        {
            provide: REDIS,
            useFactory: (env: Env) => {
                const client = createCoreRedis(env.REDIS_URL, env.REDIS_COMMAND_TIMEOUT_MS);
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
