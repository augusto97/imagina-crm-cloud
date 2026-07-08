import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { ENV, type Env } from '../config/env';
import { createDb, createPool, DRIZZLE, PG_POOL } from './client';

@Injectable()
class PoolLifecycle implements OnApplicationShutdown {
    constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

    async onApplicationShutdown(): Promise<void> {
        await this.pool.end();
    }
}

@Global()
@Module({
    providers: [
        {
            provide: PG_POOL,
            useFactory: (env: Env) => createPool(env.DATABASE_URL),
            inject: [ENV],
        },
        {
            provide: DRIZZLE,
            useFactory: (pool: Pool) => createDb(pool),
            inject: [PG_POOL],
        },
        PoolLifecycle,
    ],
    exports: [DRIZZLE, PG_POOL],
})
export class DbModule {}
