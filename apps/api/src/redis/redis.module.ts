import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

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
            useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }),
            inject: [ENV],
        },
        RedisLifecycle,
    ],
    exports: [REDIS],
})
export class RedisModule {}
