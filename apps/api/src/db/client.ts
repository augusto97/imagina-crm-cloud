import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Transacción drizzle (mismo shape que Db dentro de `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

export function createPool(connectionString: string): Pool {
    return new Pool({ connectionString, max: 10 });
}

export function createDb(pool: Pool): Db {
    return drizzle(pool, { schema });
}
