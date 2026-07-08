import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { createDb, createPool, type Db } from '../../src/db/client';

export interface TestPg {
    container: StartedPostgreSqlContainer;
    pool: Pool;
    db: Db;
    stop: () => Promise<void>;
}

/** Postgres 16 real con migraciones aplicadas (tests de RLS obligatorios, CLAUDE.md §4). */
export async function startPostgres(): Promise<TestPg> {
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const pool = createPool(container.getConnectionUri());
    const db = createDb(pool);
    await migrate(db, {
        migrationsFolder: path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
    });
    return {
        container,
        pool,
        db,
        stop: async () => {
            await pool.end();
            await container.stop();
        },
    };
}

export interface TestRedis {
    container: StartedRedisContainer;
    url: string;
    stop: () => Promise<void>;
}

export async function startRedis(): Promise<TestRedis> {
    const container = await new RedisContainer('redis:7-alpine').start();
    return {
        container,
        url: container.getConnectionUrl(),
        stop: () => container.stop().then(() => undefined),
    };
}
