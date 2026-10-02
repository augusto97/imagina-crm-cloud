import type { SqlSource } from '@imagina-base/shared';
import { SQL_LAST_SYNC_PARAM } from '@imagina-base/shared';
import { resolvePublicHost } from '../../common/safe-fetch';
import {
    SQL_VERIFY_QUERY,
    SqlRunError,
    explainSqlError,
    resolveProcedureParams,
    type SqlColumnMeta,
    type SqlConnParams,
    type SqlQueryResult,
    type SqlRunOptions,
    type SqlRunner,
    type SqlVerifyResult,
} from './sql-runner';

/**
 * Implementación real sobre el paquete `mssql` (v0.1.243).
 *
 * Se carga con `import()` la primera vez que alguien usa SQL Server: una
 * instalación que nunca conecta una base no paga el driver al arrancar.
 * Lo que se usa del paquete se tipa acá abajo (`MssqlLike`), así el motor no
 * depende de sus tipos.
 */

interface MssqlColumn {
    name: string;
    length?: number;
    type?: { declaration?: string; name?: string };
}
interface MssqlRequest {
    stream: boolean;
    input(name: string, type: unknown, value: unknown): MssqlRequest;
    input(name: string, value: unknown): MssqlRequest;
    query(sql: string): unknown;
    execute(proc: string): unknown;
    cancel(): void;
    on(event: 'recordset', cb: (columns: Record<string, MssqlColumn>) => void): MssqlRequest;
    on(event: 'row', cb: (row: Record<string, unknown>) => void): MssqlRequest;
    on(event: 'error', cb: (err: unknown) => void): MssqlRequest;
    on(event: 'done', cb: () => void): MssqlRequest;
}
interface MssqlTransaction {
    begin(): Promise<unknown>;
    rollback(): Promise<unknown>;
}
interface MssqlPool {
    connect(): Promise<unknown>;
    close(): Promise<unknown>;
}
export interface MssqlLike {
    ConnectionPool: new (config: Record<string, unknown>) => MssqlPool;
    Transaction: new (pool: MssqlPool) => MssqlTransaction;
    Request: new (parent: MssqlTransaction | MssqlPool) => MssqlRequest;
    DateTime2: unknown;
}

let loaded: Promise<MssqlLike> | null = null;

/** Espera una limpieza sin dejar que un error o una espera eterna la frenen. */
async function withDeadline(p: Promise<unknown>, ms: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
        p.catch(() => undefined),
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
        }),
    ]);
    if (timer) clearTimeout(timer);
}

async function loadMssql(): Promise<MssqlLike> {
    if (!loaded) {
        // Nombre en variable: el compilador no intenta resolver los tipos.
        const name = 'mssql';
        loaded = import(name)
            .then((mod: { default?: MssqlLike } & MssqlLike) => mod.default ?? mod)
            .catch((err: unknown) => {
                loaded = null;
                throw new SqlRunError(
                    `El servidor no tiene instalado el driver de SQL Server (paquete «mssql»): ${err instanceof Error ? err.message : String(err)}`,
                    'driver',
                );
            });
    }
    return loaded;
}

export class MssqlRunner implements SqlRunner {
    /** `load` sólo lo cambian los tests (un driver de mentira con el orden de eventos real). */
    constructor(private readonly opts: { allowPrivate: boolean; load?: () => Promise<MssqlLike> }) {}

    async verify(conn: SqlConnParams): Promise<SqlVerifyResult> {
        const res = await this.run(conn, { kind: 'query', sql: SQL_VERIFY_QUERY }, { maxRows: 1, timeoutMs: 15_000, lastSync: null });
        const row = res.rows[0] ?? {};
        return {
            login: String(row.login ?? conn.user),
            database: String(row.db ?? conn.database),
            version: String(row.version ?? ''),
            canWrite: row.can_write === true || row.can_write === 1,
        };
    }

    async run(conn: SqlConnParams, source: SqlSource, opts: SqlRunOptions): Promise<SqlQueryResult> {
        // Mismo criterio anti-SSRF que el SMTP de las empresas (SEC-27): sólo
        // servidores públicos, salvo que la instalación lo habilite.
        const target = await resolvePublicHost(conn.server, { allowPrivate: this.opts.allowPrivate });
        if (!target.ok) {
            throw new SqlRunError(
                target.reason === 'dns'
                    ? `No se encontró el servidor «${conn.server}». Revisá el nombre (sin «https://» ni la base de datos).`
                    : `«${conn.server}» es una dirección de red interna: por seguridad sólo se conecta a servidores públicos.`,
                target.reason === 'dns' ? 'dns' : 'blocked',
            );
        }
        const sql = await (this.opts.load ?? loadMssql)();
        const started = Date.now();
        const pool = new sql.ConnectionPool({
            server: conn.server,
            // Con instancia con nombre el puerto lo resuelve SQL Browser.
            ...(conn.instanceName ? {} : { port: conn.port }),
            database: conn.database,
            user: conn.user,
            password: conn.password,
            connectionTimeout: 15_000,
            requestTimeout: opts.timeoutMs,
            pool: { max: 1, min: 0, idleTimeoutMillis: 1_000 },
            options: {
                ...(conn.instanceName ? { instanceName: conn.instanceName } : {}),
                encrypt: conn.encrypt,
                trustServerCertificate: conn.trustServerCertificate,
                appName: 'Imagina Base',
                // Las fechas sin zona llegan con su hora de pared en los
                // campos UTC del Date: la zona la aplica el motor.
                useUTC: true,
            },
        });
        try {
            await pool.connect();
        } catch (err) {
            throw explainSqlError(err, conn);
        }
        try {
            const tx = new sql.Transaction(pool);
            await tx.begin();
            try {
                return await this.stream(sql, tx, source, opts, started);
            } finally {
                // SIEMPRE se deshace: lo que haya intentado escribir no queda.
                // Con tope: un rollback que no vuelve no puede trabar la cola
                // (cerrar la conexión deshace igual lo que quedó abierto).
                await withDeadline(tx.rollback(), 10_000);
            }
        } catch (err) {
            throw explainSqlError(err, conn);
        } finally {
            await withDeadline(pool.close(), 10_000);
        }
    }

    private stream(sql: MssqlLike, tx: MssqlTransaction, source: SqlSource, opts: SqlRunOptions, started: number): Promise<SqlQueryResult> {
        return new Promise<SqlQueryResult>((resolve, reject) => {
            const req = new sql.Request(tx);
            req.stream = true;
            let columns: SqlColumnMeta[] = [];
            const rows: Array<Record<string, unknown>> = [];
            let sets = 0;
            let truncated = false;
            let cancelled = false;
            let settled = false;
            let failure: unknown = null;
            // El pedido termina con «done» TAMBIÉN cuando falla («error» llega
            // antes). Se informa recién ahí: deshacer la transacción con el
            // pedido todavía en curso deja al rollback esperando para siempre
            // (lo atrapó la prueba contra un SQL Server real).
            const finish = (): void => {
                if (settled) return;
                settled = true;
                if (failure) reject(failure);
                else resolve({ columns, rows, truncated, elapsedMs: Date.now() - started });
            };
            req.on('recordset', (cols) => {
                sets++;
                if (sets === 1) {
                    columns = Object.values(cols).map((c) => ({
                        name: c.name,
                        type: String(c.type?.declaration ?? c.type?.name ?? 'unknown').toLowerCase(),
                        length: typeof c.length === 'number' ? c.length : null,
                    }));
                }
            });
            req.on('row', (row) => {
                if (sets !== 1 || cancelled) return;
                if (rows.length >= opts.maxRows) {
                    truncated = true;
                    cancelled = true;
                    req.cancel();
                    return;
                }
                rows.push(row);
            });
            req.on('error', (err) => {
                // Cortar a propósito (tope de filas) no es un error.
                if (cancelled && (err as { code?: string }).code === 'ECANCEL') return;
                if (!failure) failure = err;
            });
            req.on('done', finish);

            if (source.kind === 'query') {
                req.input(SQL_LAST_SYNC_PARAM, sql.DateTime2, opts.lastSync);
                const p = req.query(source.sql);
                if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => undefined);
            } else {
                for (const param of resolveProcedureParams(source.params, opts.lastSync)) {
                    if (param.value instanceof Date || param.value === null) req.input(param.name, sql.DateTime2, param.value);
                    else req.input(param.name, param.value);
                }
                const p = req.execute(source.name);
                if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => undefined);
            }
        });
    }
}
