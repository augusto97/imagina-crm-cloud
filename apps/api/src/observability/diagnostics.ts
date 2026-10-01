import type Redis from 'ioredis';
import type { MailLogEntry, ServerErrorEntry } from '@imagina-base/shared';

/**
 * v0.1.238 — Registro de diagnóstico de la plataforma: los últimos correos
 * (enviados, fallidos y los que no salieron por falta de SMTP) y los últimos
 * errores inesperados del servidor, en Redis.
 *
 * Por qué existe: "a veces sale error interno" y "no sé si llegan los correos"
 * no se podían responder sin entrar al servidor a leer el journal. Ahora el
 * operador lo ve en Plataforma → Diagnóstico.
 *
 * Es de módulo (no un provider de Nest) a propósito: lo usan el filtro global
 * de excepciones y el pool de Postgres, que se construyen FUERA del contenedor
 * de DI. Escribir es best-effort y nunca lanza: el diagnóstico jamás puede
 * romper la operación que está registrando.
 */

const ERRORS_KEY = 'diag:errors';
const MAIL_KEY = 'diag:mail';
const CAP = 200;
const TTL_SECONDS = 14 * 86_400;

let client: Redis | null = null;

/** Se llama una vez al crear el cliente Redis principal. */
export function attachDiagnostics(redis: Redis): void {
    client = redis;
}

function push(key: string, value: unknown): void {
    if (!client || client.status === 'end') return;
    try {
        client
            .multi()
            .lpush(key, JSON.stringify(value))
            .ltrim(key, 0, CAP - 1)
            .expire(key, TTL_SECONDS)
            .exec()
            .catch(() => undefined);
    } catch {
        /* best-effort */
    }
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function recordServerError(entry: Omit<ServerErrorEntry, 'at' | 'method' | 'path' | 'detail'> & Partial<Pick<ServerErrorEntry, 'method' | 'path' | 'detail'>>): void {
    push(ERRORS_KEY, {
        at: new Date().toISOString(),
        source: entry.source,
        method: entry.method ?? null,
        // Sin query string: puede traer tokens (reset, magic link, OAuth).
        path: entry.path ? clip(entry.path.split('?')[0]!, 200) : null,
        message: clip(entry.message || 'Error sin mensaje', 400),
        detail: entry.detail ? clip(entry.detail, 1200) : null,
    } satisfies ServerErrorEntry);
}

export function recordMail(entry: Omit<MailLogEntry, 'at'>): void {
    push(MAIL_KEY, {
        ...entry,
        to: clip(entry.to, 200),
        subject: clip(entry.subject, 200),
        error: entry.error ? clip(entry.error, 400) : null,
        at: new Date().toISOString(),
    } satisfies MailLogEntry);
}

async function readList<T>(redis: Redis, key: string, limit: number): Promise<T[]> {
    const rows = await redis.lrange(key, 0, Math.max(0, Math.min(CAP, limit) - 1));
    const out: T[] = [];
    for (const r of rows) {
        try {
            out.push(JSON.parse(r) as T);
        } catch {
            /* fila corrupta: se ignora */
        }
    }
    return out;
}

export function readMailLog(redis: Redis, limit = CAP): Promise<MailLogEntry[]> {
    return readList<MailLogEntry>(redis, MAIL_KEY, limit);
}

export function readServerErrors(redis: Redis, limit = CAP): Promise<ServerErrorEntry[]> {
    return readList<ServerErrorEntry>(redis, ERRORS_KEY, limit);
}

export async function clearDiagnostics(redis: Redis): Promise<void> {
    await redis.del(ERRORS_KEY, MAIL_KEY);
}
