import { CloudApiError } from './client';

/**
 * v0.1.238 — ¿Vale la pena reintentar? Sólo lo que no es culpa de la persona:
 * un 5xx (el servidor se reinicia, la base cortó una conexión), un 502/504
 * del proxy durante un deploy (llega como HTML → `network_error`) o un
 * `fetch` que ni siquiera obtuvo respuesta (`TypeError: Failed to fetch`).
 * Un 5xx con código PROPIO (`mail_unavailable`) es una respuesta deliberada
 * del servidor, con un mensaje para mostrar: no es transitorio.
 */
const GENERIC_CODES = new Set(['internal_error', 'network_error', 'error']);

export function isTransientError(err: unknown): boolean {
    if (err instanceof CloudApiError) {
        return err.code === 'network_error' || (err.status >= 500 && GENERIC_CODES.has(err.code));
    }
    return err instanceof TypeError;
}

/**
 * Un corte momentáneo del servidor devolvía «Error interno» en el login y había
 * que tocar «Entrar» de nuevo. El login se puede repetir sin efectos (sólo
 * valida y abre una sesión), así que ante un error transitorio se reintenta
 * UNA vez sola, sin que la persona lo note. Credenciales malas, 2FA o el freno
 * por intentos no se reintentan.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, waitMs = 1500): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        if (!isTransientError(err)) throw err;
        await new Promise((r) => setTimeout(r, waitMs));
        return fn();
    }
}
