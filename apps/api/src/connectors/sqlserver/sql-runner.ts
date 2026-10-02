import { SQL_LAST_SYNC_PARAM, SQL_LAST_SYNC_TOKEN, type SqlSource } from '@imagina-base/shared';

/**
 * Hablar con SQL Server / Azure SQL (v0.1.243).
 *
 * El motor de sincronización y la verificación de la conexión no conocen el
 * driver: hablan con esta interfaz. La implementación real (`MssqlRunner`) usa
 * el paquete `mssql` (TDS en JavaScript puro, sin dependencias nativas); los
 * tests inyectan una falsa por el token `SQL_RUNNER`.
 *
 * Reglas que cumple cualquier implementación:
 *  - TODO corre dentro de una transacción que SIEMPRE se deshace. El usuario de
 *    solo lectura es la garantía principal; ésta es la segunda capa: aunque un
 *    procedimiento intente escribir, en la base no queda nada.
 *  - Tope de filas: lo que pasa de `maxRows` no se lee (se avisa `truncated`).
 *  - Tope de tiempo por consulta.
 *  - Sólo el PRIMER conjunto de resultados de un procedimiento.
 */

export interface SqlConnParams {
    server: string;
    /** Instancia con nombre (`servidor\\SQLEXPRESS`); con ella el puerto lo resuelve SQL Browser. */
    instanceName?: string;
    port: number;
    database: string;
    user: string;
    password: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
}

export interface SqlColumnMeta {
    name: string;
    /** `nvarchar`, `int`, `datetime2`… en minúsculas. */
    type: string;
    /** Largo declarado (`-1`/`null` = sin tope, `nvarchar(max)`). */
    length: number | null;
}

export interface SqlQueryResult {
    columns: SqlColumnMeta[];
    rows: Array<Record<string, unknown>>;
    /** Había más filas que `maxRows`. */
    truncated: boolean;
    elapsedMs: number;
}

export interface SqlVerifyResult {
    login: string;
    database: string;
    version: string;
    /** El usuario puede escribir en la base (no es de solo lectura). */
    canWrite: boolean;
}

export interface SqlRunOptions {
    maxRows: number;
    timeoutMs: number;
    /** Valor de `@ultima_sincronizacion` (UTC) o null en la primera. */
    lastSync: Date | null;
}

export interface SqlRunner {
    verify(conn: SqlConnParams): Promise<SqlVerifyResult>;
    run(conn: SqlConnParams, source: SqlSource, opts: SqlRunOptions): Promise<SqlQueryResult>;
}

export const SQL_RUNNER = Symbol('SQL_RUNNER');

/** Un fallo de la base ya explicado para la persona. */
export class SqlRunError extends Error {
    constructor(
        message: string,
        readonly code: string,
    ) {
        super(message);
        this.name = 'SqlRunError';
    }
}

/**
 * Traduce los errores típicos del driver a algo que la persona pueda arreglar.
 * Conserva el mensaje original al final (es el diagnóstico para quien
 * administra la base). Puro: se testea sin red.
 */
export function explainSqlError(err: unknown, conn?: Pick<SqlConnParams, 'server' | 'database' | 'user'>): SqlRunError {
    if (err instanceof SqlRunError) return err;
    const e = (err ?? {}) as { code?: unknown; number?: unknown; message?: unknown; originalError?: { info?: { number?: unknown; message?: unknown } } };
    const raw = typeof e.message === 'string' ? e.message : String(err);
    const number = Number(e.number ?? e.originalError?.info?.number ?? NaN);
    const code = typeof e.code === 'string' ? e.code : '';
    const tail = raw ? ` (${raw.slice(0, 300)})` : '';
    const server = conn?.server ?? 'el servidor';

    if (number === 18456 || code === 'ELOGIN') {
        return new SqlRunError(
            `SQL Server rechazó el usuario o la contraseña${conn?.user ? ` de «${conn.user}»` : ''}. Revisá los datos y que el usuario tenga acceso a la base «${conn?.database ?? ''}».${tail}`,
            'login',
        );
    }
    if (number === 40615 || /not allowed to access the server/i.test(raw)) {
        const ip = raw.match(/IP address '([^']+)'/i)?.[1];
        return new SqlRunError(
            `El firewall de Azure SQL no deja entrar a este servidor${ip ? ` (IP ${ip})` : ''}. En el portal de Azure → tu servidor SQL → Redes, agregá esa IP a las reglas del firewall.`,
            'firewall',
        );
    }
    if (number === 4060 || /Cannot open database/i.test(raw)) {
        return new SqlRunError(
            `No se pudo abrir la base «${conn?.database ?? ''}»: no existe o el usuario no tiene acceso a ella.${tail}`,
            'database',
        );
    }
    if (number === 229 || number === 230 || /permission was denied/i.test(raw)) {
        return new SqlRunError(
            `El usuario no tiene permiso para lo que pide la consulta. Si usás un procedimiento, necesita permiso EXECUTE sobre él.${tail}`,
            'permission',
        );
    }
    if (number === 2812 || /Could not find stored procedure/i.test(raw)) {
        return new SqlRunError(`No existe ese procedimiento almacenado (o el usuario no lo ve).${tail}`, 'not_found');
    }
    if (number === 208 || /Invalid object name/i.test(raw)) {
        return new SqlRunError(`La consulta usa una tabla o vista que no existe (o el usuario no la ve).${tail}`, 'not_found');
    }
    if (number === 102 || number === 156 || /Incorrect syntax/i.test(raw)) {
        return new SqlRunError(`La consulta tiene un error de sintaxis.${tail}`, 'syntax');
    }
    if (code === 'ETIMEOUT' && /request/i.test(raw)) {
        return new SqlRunError(
            'La consulta tardó más que el tiempo máximo permitido. Traé menos filas (un filtro por fecha, `@ultima_sincronizacion`) o subí el tiempo máximo.',
            'timeout',
        );
    }
    if (code === 'ETIMEOUT' || code === 'ESOCKET' || /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|Failed to connect/i.test(raw)) {
        return new SqlRunError(
            `No se pudo conectar a ${server}. Revisá el nombre del servidor y el puerto, y que acepte conexiones desde la IP de este servidor (firewall de Azure, o el puerto 1433 abierto si es un servidor propio).${tail}`,
            'connect',
        );
    }
    if (/certificate|self[- ]signed|SSL|TLS/i.test(raw)) {
        return new SqlRunError(
            `Falló la conexión cifrada con ${server}. Si es un servidor propio con un certificado autofirmado, activá «Confiar en el certificado del servidor» en la conexión.${tail}`,
            'tls',
        );
    }
    return new SqlRunError(`SQL Server devolvió un error: ${raw.slice(0, 400)}`, 'other');
}

/**
 * Los parámetros de un procedimiento ya resueltos: el token de la última
 * sincronización pasa a la fecha; un valor vacío, a NULL. Puro.
 */
export function resolveProcedureParams(
    params: Array<{ name: string; value: string }>,
    lastSync: Date | null,
): Array<{ name: string; value: string | Date | null }> {
    return params.map((p) => {
        const name = p.name.replace(/^@/, '');
        const v = p.value.trim();
        if (v === SQL_LAST_SYNC_TOKEN || v === `@${SQL_LAST_SYNC_PARAM}`) return { name, value: lastSync };
        return { name, value: v === '' ? null : p.value };
    });
}

/** Comprobación de solo lectura que corre `verify`. */
export const SQL_VERIFY_QUERY = `SELECT
    SUSER_SNAME() AS login,
    DB_NAME() AS db,
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS version,
    CAST(CASE WHEN
        IS_SRVROLEMEMBER('sysadmin') = 1
        OR IS_ROLEMEMBER('db_owner') = 1
        OR IS_ROLEMEMBER('db_datawriter') = 1
        OR IS_ROLEMEMBER('db_ddladmin') = 1
        OR HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') = 1
        OR HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') = 1
        OR HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') = 1
    THEN 1 ELSE 0 END AS bit) AS can_write`;

/**
 * Los datos de la conexión como los guarda la integración → lo que necesita el
 * driver. Acepta lo que la gente copia de Azure o de SQL Server Management
 * Studio: `tcp:miservidor.database.windows.net,1433`, `https://…`,
 * `servidor:1433` o `servidor\\INSTANCIA`. Puro.
 */
export function sqlConnParams(fields: Record<string, string>, password: string): SqlConnParams {
    let server = (fields.server ?? '').trim();
    server = server.replace(/^[a-z]+:\/\//i, '').replace(/^tcp:/i, '').replace(/\/+$/, '');
    let port = Number((fields.port ?? '').trim() || 1433);
    const comma = server.match(/^(.*?),\s*(\d{1,5})$/);
    if (comma) {
        server = comma[1]!;
        port = Number(comma[2]);
    } else {
        const colon = server.match(/^([^:\\]+):(\d{1,5})$/);
        if (colon) {
            server = colon[1]!;
            port = Number(colon[2]);
        }
    }
    let instanceName: string | undefined;
    const slash = server.indexOf('\\');
    if (slash > 0) {
        instanceName = server.slice(slash + 1).trim() || undefined;
        server = server.slice(0, slash);
    }
    const bool = (v: string | undefined, dflt: boolean) => (v === undefined || v.trim() === '' ? dflt : v.trim() === 'true' || v.trim() === '1');
    return {
        server: server.trim(),
        ...(instanceName ? { instanceName } : {}),
        port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 1433,
        database: (fields.database ?? '').trim(),
        user: (fields.user ?? '').trim(),
        password,
        encrypt: bool(fields.encrypt, true),
        trustServerCertificate: bool(fields.trust_server_certificate, false),
    };
}
