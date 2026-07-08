import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DRIZZLE, type Db } from '../db/client';
import { REDIS } from '../redis/redis.module';

@Controller('health')
export class HealthController {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    @Get()
    async health(): Promise<{ status: string; postgres: boolean; redis: boolean }> {
        const [postgres, redis] = await Promise.all([
            this.db
                .execute(sql`select 1`)
                .then(() => true)
                .catch(() => false),
            this.redis
                .ping()
                .then(() => true)
                .catch(() => false),
        ]);
        return { status: postgres && redis ? 'ok' : 'degraded', postgres, redis };
    }
}
