import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

/**
 * Adjunta un listener `error` a un cliente ioredis y lo devuelve.
 *
 * Sin este listener, un error de conexión que ioredis emite de forma ASÍNCRONA
 * (p.ej. `NOAUTH Authentication required`, `ECONNREFUSED`) no tiene quién lo
 * escuche y Node tumba el proceso con "Unhandled 'error' event" — un try/catch
 * alrededor del `new Redis()` NO lo atrapa porque la conexión ocurre después.
 *
 * Con el listener el error se loguea (rate-limited para no floodear) y el
 * proceso SOBREVIVE; ioredis reintenta la conexión solo. El estado real de la
 * dependencia lo sigue reportando `/health/ready` (503 si Redis no responde),
 * así el balanceador/monitoreo actúa sin necesidad de reiniciar el proceso.
 */
export function guardRedis(client: Redis, logger: Logger, label = 'redis'): Redis {
    let lastLoggedAt = 0;
    client.on('error', (err: Error) => {
        const now = Date.now();
        // Rate-limit: un error de conexión se repite en cada reintento.
        if (now - lastLoggedAt > 5_000) {
            lastLoggedAt = now;
            logger.warn(`Conexión Redis (${label}) con error, reintentando: ${err.message}`);
        }
    });
    return client;
}
