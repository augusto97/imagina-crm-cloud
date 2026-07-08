import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DRIZZLE, type Db } from '../db/client';
import { REDIS } from '../redis/redis.module';

/**
 * Sondas de salud (F5). `/health` da el detalle; `/health/live` responde 200
 * mientras el proceso viva (liveness, k8s no lo reinicia por deps caídas);
 * `/health/ready` chequea Postgres+Redis y responde 503 si alguno falla
 * (readiness — sale del balanceador hasta recuperarse).
 */
@Controller('health')
export class HealthController {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    @Get()
    async health(): Promise<{ status: string; postgres: boolean; redis: boolean }> {
        const { postgres, redis } = await this.probe();
        return { status: postgres && redis ? 'ok' : 'degraded', postgres, redis };
    }

    @Get('live')
    live(): { status: 'ok' } {
        return { status: 'ok' };
    }

    @Get('ready')
    @HttpCode(200)
    async ready(): Promise<{ status: 'ready'; postgres: boolean; redis: boolean }> {
        const { postgres, redis } = await this.probe();
        if (!postgres || !redis) {
            throw new ServiceUnavailableException({
                code: 'not_ready',
                message: 'Dependencias no disponibles',
                data: { status: 503, errors: { postgres: String(postgres), redis: String(redis) } },
            });
        }
        return { status: 'ready', postgres, redis };
    }

    private async probe(): Promise<{ postgres: boolean; redis: boolean }> {
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
        return { postgres, redis };
    }
}
