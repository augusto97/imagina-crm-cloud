import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
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

/** Milisegundos de una variable de entorno (0 = sin tope); si no es válida, el default. */
function envMs(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export interface PoolTimeouts {
    /** Tope de cada sentencia (0 = sin tope). Default `DB_STATEMENT_TIMEOUT_MS` o 30 s. */
    statementTimeoutMs?: number;
    /**
     * Tope de una transacción abierta SIN hacer nada (0 = sin tope). Default
     * `DB_IDLE_IN_TX_TIMEOUT_MS` o 120 s — holgado a propósito: el motor de
     * automatizaciones hace pedidos HTTP y envíos de correo dentro de su
     * transacción, y esa espera cuenta como "ociosa" para Postgres.
     */
    idleInTransactionMs?: number;
}

/**
 * Topes de tiempo en la base. Sin ellos, una consulta desbocada
 * (o una transacción que quedó abierta con locks tomados porque el proceso se
 * colgó) retenía la conexión y bloqueaba a otros para siempre. Las tareas
 * administrativas largas (importar/borrar una empresa) los apagan dentro de su
 * transacción con `withoutTimeouts`; las migraciones abren su pool sin topes.
 */
export function createPool(connectionString: string, timeouts: PoolTimeouts = {}): Pool {
    const statementTimeout = timeouts.statementTimeoutMs ?? envMs('DB_STATEMENT_TIMEOUT_MS', 30_000);
    const idleInTx = timeouts.idleInTransactionMs ?? envMs('DB_IDLE_IN_TX_TIMEOUT_MS', 120_000);
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
        // Parámetros de arranque de cada conexión (0 = no se manda: sin tope).
        ...(statementTimeout > 0 ? { statement_timeout: statementTimeout } : {}),
        ...(idleInTx > 0 ? { idle_in_transaction_session_timeout: idleInTx } : {}),
        // v0.1.286 — JIT apagado por defecto (DB_JIT=on lo vuelve a prender).
        // Las subconsultas de los campos derivados (rollup, lookup, calculado,
        // set de multi_select) inflan el costo estimado y Postgres compila la
        // consulta en cada pedido: 130-270 ms de compilación para consultas que
        // corren en 200. Para una app de muchas consultas cortas no paga nunca.
        ...(process.env.DB_JIT === 'on' ? {} : { options: '-c jit=off' }),
    });
    // Una conexión PRESTADA (dentro de una transacción) que Postgres corta —
    // `idle_in_transaction_session_timeout`, reinicio de la base — emite
    // `error` en el cliente, no en el pool: sin este listener es una excepción
    // no capturada que tumba el proceso. La consulta siguiente de esa
    // transacción falla igual con su error, que es lo que corresponde.
    pool.on('connect', (client) => {
        client.on('error', (err) => {
            logger.warn(`Postgres cortó una conexión en uso: ${err.message}`);
        });
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

/**
 * Apaga los topes de tiempo SÓLO dentro de esta transacción (`SET LOCAL`):
 * para tareas administrativas que legítimamente tardan (importar o borrar una
 * empresa entera). Al terminar la transacción vuelven los de la conexión.
 */
export async function withoutTimeouts(tx: Tx): Promise<void> {
    await tx.execute(
        sql`select set_config('statement_timeout', '0', true), set_config('idle_in_transaction_session_timeout', '0', true)`,
    );
}
