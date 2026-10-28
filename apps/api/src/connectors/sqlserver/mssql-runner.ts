import { createConnection } from 'node:net';
import type { SqlSource } from '@imagina-base/shared';
import { SQL_LAST_SYNC_PARAM } from '@imagina-base/shared';
import { resolvePublicHost } from '../../common/safe-fetch';
import {
    SQL_VERIFY_QUERY,
    SqlRunError,
    explainSqlError,
    isTransientConnectError,
    resolveProcedureParams,
    type ConnectDiagnosis,
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
 * Lo que se usa del paquete se tipa aquí abajo (`MssqlLike`), así el motor no
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

/**
 * Cuánto se espera a que SQL Server abra la sesión. Eran 15 s (el default del
 * driver); Microsoft recomienda 30 s para Azure SQL: una base en pausa
 * (serverless) tarda en despertar y con 15 s la primera conexión fallaba.
 */
const CONNECT_TIMEOUT_MS = 30_000;
/** Esperas entre intentos de conexión ante una falla pasajera. */
const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000];
/** Tope para abrir el puerto en el diagnóstico (sólo cuando la conexión ya falló). */
const TCP_PROBE_TIMEOUT_MS = 6_000;

export type TcpProbe = NonNullable<ConnectDiagnosis['tcp']>;

/**
 * Abre el puerto y cierra, sin hablar SQL: separa «la red no llega» de «la
 * red llega pero la base no contesta». Va contra la IP ya validada por el
 * guard anti-SSRF. Nunca lanza.
 */
export function probeTcp(host: string, port: number, timeoutMs = TCP_PROBE_TIMEOUT_MS): Promise<TcpProbe> {
    return new Promise((resolve) => {
        const started = Date.now();
        let settled = false;
        const socket = createConnection({ host, port });
        const finish = (r: Omit<TcpProbe, 'ms'>): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve({ ...r, ms: Date.now() - started });
        };
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => finish({ status: 'open' }));
        socket.on('timeout', () => finish({ status: 'timeout' }));
        socket.on('error', (err: NodeJS.ErrnoException) => {
            const code = err.code ?? '';
            finish(
                code === 'ECONNREFUSED'
                    ? { status: 'refused' }
                    : code === 'EHOSTUNREACH' || code === 'ENETUNREACH'
                      ? { status: 'unreachable', error: code }
                      : code === 'ETIMEDOUT'
                        ? { status: 'timeout' }
                        : { status: 'error', error: code || err.message },
            );
        });
    });
}

/**
 * La IP con la que la última base vio a este servidor (`client_net_address`).
 * Por proceso: alcanza para decirle a la persona qué IP agregar al firewall
 * cuando algo falla.
 */
let knownEgressIp: string | null = null;

function rememberEgressIp(value: unknown): void {
    const ip = typeof value === 'string' ? value.trim() : '';
    // `<local machine>` cuando la conexión es por memoria compartida.
    if (ip && /^[0-9a-f.:]+$/i.test(ip)) knownEgressIp = ip;
}

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
    /** `load`, `probe`, los tiempos y las esperas sólo los cambian los tests. */
    constructor(
        private readonly opts: {
            allowPrivate: boolean;
            load?: () => Promise<MssqlLike>;
            probe?: (host: string, port: number) => Promise<TcpProbe>;
            connectTimeoutMs?: number;
            retryDelaysMs?: number[];
        },
    ) {}

    async verify(conn: SqlConnParams): Promise<SqlVerifyResult> {
        const res = await this.run(conn, { kind: 'query', sql: SQL_VERIFY_QUERY }, { maxRows: 1, timeoutMs: 15_000, lastSync: null, connectAttempts: 1 });
        const row = res.rows[0] ?? {};
        rememberEgressIp(row.client_ip);
        return {
            login: String(row.login ?? conn.user),
            database: String(row.db ?? conn.database),
            version: String(row.version ?? ''),
            canWrite: row.can_write === true || row.can_write === 1,
            clientIp: typeof row.client_ip === 'string' && row.client_ip.trim() ? row.client_ip.trim() : null,
        };
    }

    async run(conn: SqlConnParams, source: SqlSource, opts: SqlRunOptions): Promise<SqlQueryResult> {
        // Mismo criterio anti-SSRF que el SMTP de las empresas (SEC-27): sólo
        // servidores públicos, salvo que la instalación lo habilite.
        const target = await resolvePublicHost(conn.server, { allowPrivate: this.opts.allowPrivate });
        if (!target.ok) {
            throw new SqlRunError(
                target.reason === 'dns'
                    ? `No se encontró el servidor «${conn.server}». Revisa el nombre (sin «https://» ni la base de datos).`
                    : `«${conn.server}» es una dirección de red interna: por seguridad sólo se conecta a servidores públicos.`,
                target.reason === 'dns' ? 'dns' : 'blocked',
            );
        }
        const sql = await (this.opts.load ?? loadMssql)();
        const started = Date.now();
        const connectTimeoutMs = this.opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
        const config = {
            server: conn.server,
            // Con instancia con nombre el puerto lo resuelve SQL Browser.
            ...(conn.instanceName ? {} : { port: conn.port }),
            database: conn.database,
            user: conn.user,
            password: conn.password,
            connectionTimeout: connectTimeoutMs,
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
        };
        // Conectar, reintentando lo pasajero (la red que no contesta, Azure
        // despertando una base en pausa). Usuario/contraseña, firewall o
        // certificado no se reintentan: fallarían igual.
        const maxAttempts = Math.max(1, opts.connectAttempts ?? 3);
        const delays = this.opts.retryDelaysMs ?? CONNECT_RETRY_DELAYS_MS;
        let pool: MssqlPool | null = null;
        let attempts = 0;
        for (;;) {
            attempts++;
            const candidate = new sql.ConnectionPool(config);
            try {
                await candidate.connect();
                pool = candidate;
                break;
            } catch (err) {
                await withDeadline(candidate.close(), 5_000);
                if (attempts < maxAttempts && isTransientConnectError(err)) {
                    await new Promise((r) => setTimeout(r, delays[Math.min(attempts - 1, delays.length - 1)] ?? 2_000));
                    continue;
                }
                const diag: ConnectDiagnosis = {
                    attempts,
                    elapsedMs: Date.now() - started,
                    timeoutMs: connectTimeoutMs,
                    addresses: target.addresses,
                    port: conn.instanceName ? null : conn.port,
                    tcp: conn.instanceName ? null : await (this.opts.probe ?? probeTcp)(target.address, conn.port),
                    egressIp: knownEgressIp,
                };
                throw explainSqlError(err, conn, diag);
            }
        }
        try {
            const tx = new sql.Transaction(pool);
            await tx.begin();
            try {
                if (!knownEgressIp) await this.learnEgressIp(sql, tx);
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

    /** Una vez por proceso: qué IP ve la base (para el mensaje de un fallo futuro). Nunca lanza. */
    private async learnEgressIp(sql: MssqlLike, tx: MssqlTransaction): Promise<void> {
        try {
            const res = await this.stream(sql, tx, { kind: 'query', sql: "SELECT CAST(CONNECTIONPROPERTY('client_net_address') AS nvarchar(64)) AS client_ip" }, { maxRows: 1, timeoutMs: 5_000, lastSync: null }, Date.now());
            rememberEgressIp(res.rows[0]?.client_ip);
        } catch {
            /* sin el dato, el mensaje de un fallo simplemente no lo muestra */
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
