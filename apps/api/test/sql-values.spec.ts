import { describe, expect, it } from 'vitest';
import { explainSqlError, resolveProcedureParams, sqlConnParams } from '../src/connectors/sqlserver/sql-runner';
import { MssqlRunner } from '../src/connectors/sqlserver/mssql-runner';
import { findColumn, sqlCellToText, suggestFieldType } from '../src/connectors/sqlserver/sql-values';

/** Un `datetime` sin zona como lo entrega el driver con useUTC: la hora de pared en los campos UTC. */
const wall = (iso: string) => new Date(`${iso}Z`);

describe('SQL Server — valores (v0.1.243)', () => {
    it('datetime sin zona se interpreta en la zona de la sincronización y pasa a UTC', () => {
        // 14:05 en Bogotá (UTC−5) = 19:05 UTC.
        expect(sqlCellToText(wall('2026-03-15T14:05:00'), 'datetime2', 'datetime', 'America/Bogota')).toBe('2026-03-15T19:05:00Z');
        // En UTC queda igual.
        expect(sqlCellToText(wall('2026-03-15T14:05:00'), 'datetime', 'datetime', 'UTC')).toBe('2026-03-15T14:05:00Z');
    });

    it('datetimeoffset es un instante: no se le aplica zona', () => {
        expect(sqlCellToText(new Date('2026-03-15T19:05:00Z'), 'datetimeoffset', 'datetime', 'America/Bogota')).toBe('2026-03-15T19:05:00Z');
    });

    it('destino fecha: el día de pared, sin correrse por la zona', () => {
        // Lunes 21:00 en Bogotá NO es martes.
        expect(sqlCellToText(wall('2026-03-16T21:00:00'), 'datetime', 'date', 'America/Bogota')).toBe('2026-03-16');
        expect(sqlCellToText(wall('2026-03-16T00:00:00'), 'date', 'date', 'America/Bogota')).toBe('2026-03-16');
        // Un instante a una fecha: el día de la zona.
        expect(sqlCellToText(new Date('2026-03-17T02:00:00Z'), 'datetimeoffset', 'date', 'America/Bogota')).toBe('2026-03-16');
    });

    it('números, sí/no, texto, binarios y NULL', () => {
        expect(sqlCellToText(1250.5, 'decimal', 'currency', 'UTC')).toBe('1250.5');
        expect(sqlCellToText(true, 'bit', 'checkbox', 'UTC')).toBe('true');
        expect(sqlCellToText('900123456-7', 'nvarchar', 'text', 'UTC')).toBe('900123456-7');
        expect(sqlCellToText(null, 'int', 'number', 'UTC')).toBeNull();
        expect(sqlCellToText(new Uint8Array([1, 2]), 'varbinary', 'text', 'UTC')).toBeNull();
        expect(sqlCellToText(BigInt('9007199254740993'), 'bigint', 'text', 'UTC')).toBe('9007199254740993');
    });

    it('sugiere el tipo de campo por el tipo de la columna', () => {
        expect(suggestFieldType('int', 4)).toBe('number');
        expect(suggestFieldType('money', 8)).toBe('currency');
        expect(suggestFieldType('bit', 1)).toBe('checkbox');
        expect(suggestFieldType('date', 3)).toBe('date');
        expect(suggestFieldType('datetime2', 8)).toBe('datetime');
        expect(suggestFieldType('nvarchar', 100)).toBe('text');
        expect(suggestFieldType('nvarchar', -1)).toBe('long_text');
    });

    it('encuentra la columna sin distinguir mayúsculas', () => {
        const cols = [{ name: 'NumeroFactura' }, { name: 'NIT' }];
        expect(findColumn(cols, 'numerofactura')).toBe('NumeroFactura');
        expect(findColumn(cols, 'NIT')).toBe('NIT');
        expect(findColumn(cols, 'Total')).toBeNull();
    });

    it('parámetros del procedimiento: la última sincronización y los vacíos', () => {
        const last = new Date('2026-10-01T10:00:00Z');
        expect(
            resolveProcedureParams(
                [
                    { name: '@desde', value: '{{ultima_sincronizacion}}' },
                    { name: 'empresa', value: '12' },
                    { name: '@nota', value: '  ' },
                ],
                last,
            ),
        ).toEqual([
            { name: 'desde', value: last },
            { name: 'empresa', value: '12' },
            { name: 'nota', value: null },
        ]);
    });

    it('explica los errores típicos de SQL Server', () => {
        const conn = { server: 'x.database.windows.net', database: 'Ventas', user: 'lector' };
        expect(explainSqlError({ number: 18456, message: "Login failed for user 'lector'." }, conn).code).toBe('login');
        const fw = explainSqlError(
            { number: 40615, message: "Cannot open server 'x' requested by the login. Client with IP address '203.0.113.9' is not allowed to access the server." },
            conn,
        );
        expect(fw.code).toBe('firewall');
        expect(fw.message).toContain('203.0.113.9');
        expect(explainSqlError({ number: 4060, message: 'Cannot open database "Ventas"' }, conn).code).toBe('database');
        // Mensaje REAL del driver ante un certificado autofirmado: llega como ESOCKET.
        expect(explainSqlError({ code: 'ESOCKET', message: 'Failed to connect to 127.0.0.1:14330 - self-signed certificate' }, conn).code).toBe('tls');
        expect(explainSqlError({ number: 208, message: "Invalid object name 'Facturas'." }, conn).code).toBe('not_found');
        expect(explainSqlError({ number: 102, message: "Incorrect syntax near 'FORM'." }, conn).code).toBe('syntax');
        expect(explainSqlError({ code: 'ETIMEOUT', message: 'Timeout: Request failed to complete in 60000ms' }, conn).code).toBe('timeout');
        expect(explainSqlError({ code: 'ESOCKET', message: 'Failed to connect to x:1433 - connect ECONNREFUSED' }, conn).code).toBe('connect');
        expect(explainSqlError({ message: 'self-signed certificate' }, conn).code).toBe('tls');
    });
});

describe('SQL Server — datos de la conexión (v0.1.243)', () => {
    it('acepta lo que se copia de Azure o de SSMS', async () => {
        const { sqlConnParams } = await import('../src/connectors/sqlserver/sql-runner');
        const base = { database: 'Ventas', user: 'lector' };
        expect(sqlConnParams({ ...base, server: 'tcp:acme.database.windows.net,1433' }, 'pw')).toMatchObject({
            server: 'acme.database.windows.net',
            port: 1433,
            encrypt: true,
            trustServerCertificate: false,
            password: 'pw',
        });
        expect(sqlConnParams({ ...base, server: 'https://acme.example.com/' }, 'pw').server).toBe('acme.example.com');
        expect(sqlConnParams({ ...base, server: 'db.acme.com:14330' }, 'pw')).toMatchObject({ server: 'db.acme.com', port: 14330 });
        expect(sqlConnParams({ ...base, server: 'srv01\\SQLEXPRESS' }, 'pw')).toMatchObject({ server: 'srv01', instanceName: 'SQLEXPRESS' });
        expect(sqlConnParams({ ...base, server: 'x', port: '1500', encrypt: 'false', trust_server_certificate: 'true' }, 'pw')).toMatchObject({
            port: 1500,
            encrypt: false,
            trustServerCertificate: true,
        });
    });

    it('un error del servidor se informa al terminar el pedido: el rollback nunca se queda colgado (prueba real contra SQL Server)', async () => {
        // El driver real emite «error» y DESPUÉS «done»; deshacer la transacción
        // en el medio deja al rollback esperando para siempre. Este falso imita
        // ese orden y cuelga el rollback si llega antes del «done».
        let done = false;
        let rolledBackEarly = false;
        class FakeRequest {
            stream = false;
            private h: Record<string, (x?: unknown) => void> = {};
            input(): this { return this; }
            on(ev: string, cb: (x?: unknown) => void): this { this.h[ev] = cb; return this; }
            cancel(): void {}
            query(): void {
                setTimeout(() => this.h.error?.(Object.assign(new Error("Incorrect syntax near 'WHERE'."), { number: 102 })), 5);
                setTimeout(() => { done = true; this.h.done?.(); }, 30);
            }
            execute(): void {}
        }
        const fake = {
            ConnectionPool: class { async connect() {} async close() {} },
            Transaction: class {
                async begin() {}
                rollback(): Promise<void> {
                    if (!done) { rolledBackEarly = true; return new Promise(() => undefined); }
                    return Promise.resolve();
                }
            },
            Request: FakeRequest,
            DateTime2: 'DateTime2',
        };
        const runner = new MssqlRunner({ allowPrivate: true, load: async () => fake as never });
        const conn = sqlConnParams({ server: '127.0.0.1', database: 'db', user: 'u' }, 'p');
        const started = Date.now();
        await expect(runner.run(conn, { kind: 'query', sql: 'SELECT * FROM t WHERE' }, { maxRows: 10, timeoutMs: 1000, lastSync: null })).rejects.toThrow(/sintaxis/);
        expect(rolledBackEarly).toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});
