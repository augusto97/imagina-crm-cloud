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
    /**
     * La IP con la que la base ve a este servidor (`client_net_address`): la
     * que hay que agregar a un firewall. null si la base no la informa.
     */
    clientIp: string | null;
}

export interface SqlRunOptions {
    maxRows: number;
    timeoutMs: number;
    /** Valor de `@ultima_sincronizacion` (UTC) o null en la primera. */
    lastSync: Date | null;
    /**
     * Intentos de CONEXIÓN ante una falla pasajera (la red que no contesta,
     * Azure despertando una base en pausa). Por defecto 3; la verificación
     * desde la pantalla usa 1 para no dejar a la persona esperando.
     */
    connectAttempts?: number;
}

export interface SqlRunner {
    verify(conn: SqlConnParams): Promise<SqlVerifyResult>;
    run(conn: SqlConnParams, source: SqlSource, opts: SqlRunOptions): Promise<SqlQueryResult>;
}

export const SQL_RUNNER = Symbol('SQL_RUNNER');

/**
 * Lo que se vio al intentar conectar (v0.1.330). «Failed to connect in
 * 15000ms» no decía si la base había respondido algo: con esto el mensaje
 * cuenta en qué paso se cortó —el nombre, el puerto, el inicio de sesión—,
 * así se sabe si el problema es de la red, de la base o de la app.
 */
export interface ConnectDiagnosis {
    attempts: number;
    elapsedMs: number;
    /** Lo que se esperó por intento a que SQL Server abriera la sesión. */
    timeoutMs: number;
    /** A qué IPs resolvió el nombre del servidor. */
    addresses: string[];
    /** null = instancia con nombre: el puerto lo resuelve SQL Browser. */
    port: number | null;
    /** Abrir el puerto, sin hablar SQL. null = no se probó. */
    tcp: { status: 'open' | 'refused' | 'timeout' | 'unreachable' | 'error'; ms: number; error?: string } | null;
    /** La IP con la que este servidor sale a internet, si se conoce. */
    egressIp: string | null;
}

/**
 * Errores de Azure SQL / SQL Server que son PASAJEROS: la base en pausa
 * (serverless), cambiando de nodo, saturada o en mantenimiento. Microsoft
 * recomienda reintentar la conexión ante ellos.
 */
export const TRANSIENT_SQL_ERRORS = new Set([40613, 40501, 40197, 40540, 40143, 49918, 49919, 49920, 10928, 10929, 10053, 10054, 10060, 4221, 233, 64]);

/** ¿Vale la pena reintentar la conexión? Nunca ante usuario/contraseña, firewall ni certificado. */
export function isTransientConnectError(err: unknown): boolean {
    const e = (err ?? {}) as { code?: unknown; number?: unknown; message?: unknown; originalError?: { info?: { number?: unknown } } };
    const number = Number(e.number ?? e.originalError?.info?.number ?? NaN);
    if (Number.isFinite(number)) return TRANSIENT_SQL_ERRORS.has(number);
    const raw = typeof e.message === 'string' ? e.message : '';
    if (/certificate|self[- ]signed|SSL|TLS|ENOTFOUND|EAI_AGAIN/i.test(raw)) return false;
    return e.code === 'ETIMEOUT' || e.code === 'ESOCKET' || /ETIMEDOUT|ECONNRESET|socket hang up/i.test(raw);
}

/** Lo que contestó SQL Server tal cual (número y texto), si el error vino de él. */
export function serverReply(err: unknown): { number: number; message: string } | null {
    const e = (err ?? {}) as { number?: unknown; message?: unknown; originalError?: { info?: { number?: unknown; message?: unknown } } };
    const number = Number(e.number ?? e.originalError?.info?.number ?? NaN);
    if (!Number.isFinite(number) || number <= 0) return null;
    const msg = e.originalError?.info?.message ?? e.message;
    return { number, message: typeof msg === 'string' ? msg.slice(0, 400) : '' };
}

function seconds(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = Math.round(ms / 1000);
    return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

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
export function explainSqlError(
    err: unknown,
    conn?: Pick<SqlConnParams, 'server' | 'database' | 'user'>,
    diag?: ConnectDiagnosis,
): SqlRunError {
    if (err instanceof SqlRunError) return err;
    const e = (err ?? {}) as { code?: unknown; number?: unknown; message?: unknown; originalError?: { info?: { number?: unknown; message?: unknown } } };
    const raw = typeof e.message === 'string' ? e.message : String(err);
    const number = Number(e.number ?? e.originalError?.info?.number ?? NaN);
    const code = typeof e.code === 'string' ? e.code : '';
    const reply = serverReply(err);
    // Lo que contestó la base, literal y aparte: quien administra la base lo
    // necesita para buscarlo, y deja claro que el error viene de ELLA.
    const tail = reply
        ? `\nRespuesta de SQL Server (error ${reply.number}): «${reply.message}»`
        : raw
          ? `\nDetalle técnico: ${code ? `${code} · ` : ''}${raw.slice(0, 300)}`
          : '';
    const server = conn?.server ?? 'el servidor';
    const egress = diag?.egressIp ? `\nIP de este servidor (la que se agrega al firewall): ${diag.egressIp}` : '';

    if (number === 18456 || code === 'ELOGIN') {
        return new SqlRunError(
            `SQL Server rechazó el usuario o la contraseña${conn?.user ? ` de «${conn.user}»` : ''}. Revisa los datos y que el usuario tenga acceso a la base «${conn?.database ?? ''}».${tail}`,
            'login',
        );
    }
    if (number === 40615 || /not allowed to access the server/i.test(raw)) {
        const ip = raw.match(/IP address '([^']+)'/i)?.[1];
        return new SqlRunError(
            `El firewall de Azure SQL no deja entrar a este servidor${ip ? ` (IP ${ip})` : ''}. En el portal de Azure → tu servidor SQL → Redes, agrega esa IP a las reglas del firewall.${tail}`,
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
            `El usuario no tiene permiso para lo que pide la consulta. Si usas un procedimiento, necesita permiso EXECUTE sobre él.${tail}`,
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
            'La consulta tardó más que el tiempo máximo permitido. Trae menos filas (un filtro por fecha, `@ultima_sincronizacion`) o sube el tiempo máximo.',
            'timeout',
        );
    }
    // Antes que el genérico de conexión: el driver informa un certificado
    // rechazado como ESOCKET/«Failed to connect» y el consejo correcto es otro.
    if (/certificate|self[- ]signed|SSL|TLS/i.test(raw)) {
        return new SqlRunError(
            `Falló la conexión cifrada con ${server}. Si es un servidor propio con un certificado autofirmado, activa «Confiar en el certificado del servidor» en la conexión.${tail}`,
            'tls',
        );
    }
    if (Number.isFinite(number) && TRANSIENT_SQL_ERRORS.has(number)) {
        const tries = diag && diag.attempts > 1 ? ` Se intentó ${diag.attempts} veces en ${seconds(diag.elapsedMs)}.` : '';
        return new SqlRunError(
            `La base de datos de ${server} respondió que no está disponible en este momento. Es del lado de la base, no de la app: en Azure SQL pasa cuando la base está en pausa (nivel «serverless», tarda en despertar), saturada, en mantenimiento o cambiando de nodo. Suele resolverse sola; si se repite seguido, revisa el estado de la base en el portal de Azure.${tries}${tail}`,
            'unavailable',
        );
    }
    if (code === 'ETIMEOUT' || code === 'ESOCKET' || /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ENOTFOUND|Failed to connect/i.test(raw)) {
        if (!diag) {
            return new SqlRunError(
                `No se pudo conectar a ${server}. Revisa el nombre del servidor y el puerto, y que acepte conexiones desde la IP de este servidor (firewall de Azure, o el puerto 1433 abierto si es un servidor propio).${tail}`,
                'connect',
            );
        }
        return new SqlRunError(explainConnectFailure(server, code, raw, diag) + egress + tail, 'connect');
    }
    return new SqlRunError(`SQL Server devolvió un error: ${raw.slice(0, 400)}`, 'other');
}

/**
 * El texto de una conexión que no se pudo abrir, con lo que se vio en cada
 * paso. Puro: lo arma `explainSqlError` con el diagnóstico de `MssqlRunner`.
 */
export function explainConnectFailure(server: string, code: string, raw: string, diag: ConnectDiagnosis): string {
    const port = diag.port ?? 1433;
    const timedOut = code === 'ETIMEOUT' || /in \d+ms|ETIMEDOUT|timeout/i.test(raw);
    const lines: string[] = [];
    let headline: string;
    let meaning: string;
    const tcp = diag.tcp;
    if (tcp?.status === 'timeout') {
        headline = `No se pudo conectar a ${server}: la base de datos no respondió nada, la conexión ni siquiera llegó a abrirse.`;
        meaning =
            'Algo en el camino descarta el tráfico antes de llegar a SQL Server: un firewall de la red de la base de datos, una regla de salida de este servidor, o el servidor de base de datos apagado o caído en ese momento. La app no llega a mandar la consulta, así que no es un problema de la consulta ni de los datos. Si después vuelve a funcionar sola, fue un corte pasajero de la red o del servidor de base de datos.';
    } else if (tcp?.status === 'refused') {
        headline = `No se pudo conectar a ${server}: el servidor rechazó la conexión en el puerto ${port}.`;
        meaning = `El servidor está encendido pero no acepta conexiones en el puerto ${port}: revisa el puerto, que SQL Server tenga habilitado TCP/IP, o un firewall que la rechace.`;
    } else if (tcp?.status === 'unreachable') {
        headline = `No se pudo conectar a ${server}: no hay ruta de red hasta el servidor.`;
        meaning = 'Este servidor no encuentra un camino hasta esa dirección. Suele ser una dirección que no es pública o un problema de red del proveedor.';
    } else if (tcp?.status === 'open' && timedOut) {
        headline = `No se pudo conectar a ${server}: la red sí llega, pero SQL Server no terminó de abrir la sesión.`;
        meaning =
            'El problema está del lado de la base de datos, no en la app: el servidor acepta la conexión pero no contesta el inicio de sesión. En Azure SQL pasa cuando la base está en pausa (nivel «serverless», tarda en despertar), saturada, en mantenimiento o cambiando de nodo. Suele resolverse sola; si se repite seguido, revisa el estado de la base en el portal de Azure.';
    } else if (tcp?.status === 'open') {
        headline = `No se pudo conectar a ${server}: la red sí llega, pero la conexión se cortó mientras SQL Server abría la sesión.`;
        meaning = 'Un firewall, un proxy o el propio servidor cortó la conexión a mitad del inicio de sesión. Suele ser la base reiniciándose o un equipo de red que corta el tráfico de SQL Server.';
    } else {
        headline = `No se pudo conectar a ${server}.`;
        meaning = 'Revisa el nombre del servidor y el puerto, y que acepte conexiones desde la IP de este servidor (firewall de Azure, o el puerto 1433 abierto si es un servidor propio).';
    }
    lines.push(headline, '', 'Qué se probó:');
    if (diag.addresses.length) lines.push(`· El nombre se encontró: ${diag.addresses.slice(0, 3).join(', ')}.`);
    if (tcp) {
        const label = { open: `abrió en ${seconds(tcp.ms)}`, refused: 'rechazó la conexión', timeout: `no respondió en ${seconds(tcp.ms)}`, unreachable: 'sin ruta de red', error: `falló (${tcp.error ?? 'error'})` }[tcp.status];
        lines.push(`· El puerto ${port}: ${label}.`);
    }
    lines.push(
        tcp && tcp.status !== 'open'
            ? '· Inicio de sesión en SQL Server: no se llegó (no hubo conexión de red).'
            : `· Inicio de sesión en SQL Server: ${timedOut ? `sin respuesta en ${seconds(diag.timeoutMs)}` : 'la conexión se cortó'}.`,
    );
    if (diag.attempts > 1) lines.push(`· Intentos: ${diag.attempts} en ${seconds(diag.elapsedMs)}.`);
    lines.push(
        `Respuesta del servidor: ninguna${timedOut ? ' (no contestó)' : ''}.`,
        '',
        meaning,
    );
    return lines.join('\n');
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
    THEN 1 ELSE 0 END AS bit) AS can_write,
    CAST(CONNECTIONPROPERTY('client_net_address') AS nvarchar(64)) AS client_ip`;

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
