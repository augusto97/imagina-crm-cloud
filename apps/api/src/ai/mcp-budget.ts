import { incrWithTtl, type IncrRedis } from '../redis/redis.util';

/**
 * Presupuesto del endpoint MCP. El rate limit general es por IP y un token de
 * acceso no tenía tope propio: un cliente (o un agente en bucle) podía llamar
 * herramientas sin fin — cada una son consultas a la base — desde muchas IPs.
 *
 *  - como mucho `MCP_MAX_CALLS_PER_POST` llamadas a herramientas por POST
 *    (un lote JSON-RPC);
 *  - `MCP_TOKEN_CALLS_PER_MINUTE` llamadas por minuto por token;
 *  - `MCP_TENANT_CALLS_PER_MINUTE` por minuto por empresa (todos sus tokens).
 *
 * Se cuenta por llamada a herramienta (`tools/call`); un POST sin ninguna
 * (initialize, tools/list) cuenta como una. Ventana fija de un minuto en
 * Redis, compartida entre servidores. Si Redis no responde no se bloquea.
 */
export const MCP_MAX_CALLS_PER_POST = 20;
export const MCP_TOKEN_CALLS_PER_MINUTE = 120;
export const MCP_TENANT_CALLS_PER_MINUTE = 600;

export interface McpBudgetResult {
    ok: boolean;
    /** Código JSON-RPC del rechazo. */
    code?: number;
    message?: string;
    retryAfter?: number;
}

/** Cuántas llamadas a herramientas trae el cuerpo (mensaje suelto o lote). */
export function countToolCalls(body: unknown): number {
    const messages = Array.isArray(body) ? body : [body];
    let n = 0;
    for (const m of messages) {
        if (m && typeof m === 'object' && (m as { method?: unknown }).method === 'tools/call') n += 1;
    }
    return n;
}

/** El `id` JSON-RPC para responder el error (null en un lote). */
export function jsonRpcId(body: unknown): string | number | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const id = (body as { id?: unknown }).id;
    return typeof id === 'string' || typeof id === 'number' ? id : null;
}

export async function checkMcpBudget(
    redis: IncrRedis,
    who: { tokenId: number; tenantId: number },
    body: unknown,
    now = Date.now(),
): Promise<McpBudgetResult> {
    const calls = countToolCalls(body);
    if (calls > MCP_MAX_CALLS_PER_POST) {
        return {
            ok: false,
            code: -32600,
            message: `Demasiadas llamadas a herramientas en un mismo pedido (${calls}): el máximo es ${MCP_MAX_CALLS_PER_POST}.`,
        };
    }
    const cost = Math.max(1, calls);
    const minute = Math.floor(now / 60_000);
    const retryAfter = 60 - Math.floor((now % 60_000) / 1000);
    try {
        const scopes: Array<[string, number, string]> = [
            [`mcp:rl:t:${who.tokenId}:${minute}`, MCP_TOKEN_CALLS_PER_MINUTE, 'este token'],
            [`mcp:rl:e:${who.tenantId}:${minute}`, MCP_TENANT_CALLS_PER_MINUTE, 'esta empresa'],
        ];
        for (const [key, limit, label] of scopes) {
            let used = 0;
            for (let i = 0; i < cost; i += 1) used = await incrWithTtl(redis, key, 120);
            if (used > limit) {
                return {
                    ok: false,
                    code: -32029,
                    message: `Se alcanzó el máximo de llamadas por minuto de ${label} (${limit}). Espera ${retryAfter} segundos y vuelve a intentar.`,
                    retryAfter,
                };
            }
        }
    } catch {
        // Sin Redis no se bloquea el trabajo (el límite por IP sigue activo).
    }
    return { ok: true };
}
