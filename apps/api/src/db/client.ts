import { Logger } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { recordServerError } from '../observability/diagnostics';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Transacción drizzle (mismo shape que Db dentro de `db.transaction`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

const logger = new Logger('Postgres');

/**
 * v0.1.238 — Pool resistente a cortes de la base.
 *
 * Sin un listener `error`, una conexión OCIOSA que Postgres cierra (reinicio
 * del contenedor, mantenimiento, `pg_terminate_backend`, un corte de red) hace
 * que el Pool emita `error` sin nadie que lo escuche → Node TUMBA EL PROCESO.
 * Reproducido: reiniciar Postgres o terminar sus conexiones mataba el API, y
 * hasta que systemd lo levantaba de nuevo cada login respondía con error — el
 * "a veces sale error interno y hay que intentar varias veces". Con el
 * listener, la conexión rota se descarta y la próxima consulta abre una nueva.
 *
 *  - `keepAlive`: detecta conexiones muertas en silencio (NAT, firewall) en
 *    vez de colgar la próxima consulta hasta el timeout de TCP.
 *  - `connectionTimeoutMillis`: si la base no acepta conexiones, el pedido
 *    falla en 10 s con un error claro en vez de esperar para siempre.
 */
function poolMax(): number {
    const n = Number(process.env.DB_POOL_MAX);
    return Number.isInteger(n) && n >= 2 && n <= 200 ? n : 20;
}

export function createPool(connectionString: string): Pool {
    const pool = new Pool({
        connectionString,
        // v0.1.252 — configurable (DB_POOL_MAX). 20 por defecto: la API y los
        // workers (automatizaciones, sincronizaciones, cobros) comparten el
        // pool, y con 10 unos pocos tableros abiertos lo agotaban. Postgres
        // acepta 100 conexiones por defecto: sobra para un nodo.
        max: poolMax(),
        keepAlive: true,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
        logger.warn(`Conexión a Postgres cerrada (se abre otra en la próxima consulta): ${err.message}`);
        recordServerError({ source: 'database', message: `Conexión a Postgres cerrada: ${err.message}` });
    });
    return pool;
}

export function createDb(pool: Pool): Db {
    return drizzle(pool, { schema });
}
