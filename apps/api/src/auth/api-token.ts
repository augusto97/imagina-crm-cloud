import { incrWithTtl, type IncrRedis } from '../redis/redis.util';

/**
 * v0.1.441 (G1) — API pública REST con tokens personales (`ib_pat_…` creados
 * «para la API»). El token actúa COMO la persona que lo creó, en UNA empresa:
 * rol, rol propio, equipos y el ACL de cada lista se aplican igual que en la
 * interfaz, porque el pedido pasa por los mismos guards y services.
 *
 * Lo que un token NO puede es lo de esta lista blanca hacia afuera: sólo las
 * rutas pensadas para programas (listas, campos, vistas, registros,
 * comentarios, búsqueda, archivos, personas y equipos). Fuera quedan cuenta y
 * seguridad (contraseña, 2FA, sesiones, crear otros tokens), miembros,
 * cobros, ajustes de la empresa, consolas del operador y todo lo demás:
 * aunque la persona sea administradora, un token filtrado no debe poder
 * invitar gente, cambiar el correo de la empresa ni crear más tokens. Una
 * ruta nueva queda afuera hasta que se la agregue aquí a propósito.
 */
export interface ApiTokenRoute {
    /** El PATRÓN de la ruta tal como lo registra el router (`routePath`). */
    route: string;
    methods: readonly string[];
}

const READ = ['GET', 'HEAD'] as const;

export const API_TOKEN_ROUTES: readonly ApiTokenRoute[] = [
    // Quién soy (para probar el token desde n8n, Make o un script).
    { route: '/api/v1/whoami', methods: READ },
    // Listas: leer, crear y cambiar (borrar una lista, sólo desde la app).
    { route: '/api/v1/lists', methods: [...READ, 'POST'] },
    { route: '/api/v1/lists/:idOrSlug', methods: [...READ, 'PATCH'] },
    { route: '/api/v1/list-groups', methods: READ },
    // Campos: leer, crear y cambiar (borrar un campo, sólo desde la app).
    { route: '/api/v1/lists/:list/fields', methods: [...READ, 'POST'] },
    { route: '/api/v1/lists/:list/fields/:field', methods: [...READ, 'PATCH'] },
    { route: '/api/v1/lists/:list/fields/:field/options', methods: ['POST'] },
    { route: '/api/v1/lists/:list/fields/:field/values', methods: READ },
    // Vistas guardadas: sólo leer (los filtros de una vista sirven para traer registros).
    { route: '/api/v1/lists/:list/views', methods: READ },
    { route: '/api/v1/lists/:list/views/:id', methods: READ },
    // Registros: todo lo de una persona (crear, cambiar, borrar → papelera) y en lote.
    { route: '/api/v1/lists/:list/records', methods: [...READ, 'POST'] },
    { route: '/api/v1/lists/:list/records/batch', methods: ['POST', 'PATCH'] },
    { route: '/api/v1/lists/:list/records/batch-delete', methods: ['POST'] },
    { route: '/api/v1/lists/:list/records/:id', methods: [...READ, 'PATCH', 'DELETE'] },
    { route: '/api/v1/lists/:list/records/:id/description', methods: [...READ, 'PATCH'] },
    { route: '/api/v1/lists/:list/records/:recordId/comments', methods: [...READ, 'POST'] },
    { route: '/api/v1/lists/:list/records/:recordId/comments/:id', methods: ['PATCH', 'DELETE'] },
    // Búsqueda en toda la empresa (con el ACL de cada lista).
    { route: '/api/v1/search', methods: READ },
    // Archivos: subir, ver los datos de varios y descargar.
    { route: '/api/v1/files', methods: [...READ, 'POST'] },
    { route: '/api/v1/files/:id/download', methods: READ },
    // Personas y equipos (para asignar un campo Persona o Equipo).
    { route: '/api/v1/me/users-search', methods: READ },
    { route: '/api/v1/me/users', methods: READ },
    { route: '/api/v1/me/users/:id', methods: READ },
    { route: '/api/v1/teams', methods: READ },
    { route: '/api/v1/teams/:id', methods: READ },
];

export type ApiTokenRouteVerdict = { ok: true } | { ok: false; code: 'api_route_not_allowed' | 'api_read_only'; message: string };

/**
 * ¿Un token de la API puede usar esta ruta con este método? `route` es el
 * PATRÓN que eligió el router (`/api/v1/lists/:list/records`), nunca el texto
 * de la dirección (ver `routePath`). Un token de sólo lectura sólo hace GET.
 */
export function apiTokenRouteAllowed(method: string, route: string, scope: 'read' | 'full'): ApiTokenRouteVerdict {
    const m = method.toUpperCase();
    const entry = API_TOKEN_ROUTES.find((r) => r.route === route);
    if (!entry || !entry.methods.includes(m)) {
        return { ok: false, code: 'api_route_not_allowed', message: 'Esta acción no está disponible por la API: hazla desde la app.' };
    }
    if (scope === 'read' && m !== 'GET' && m !== 'HEAD') {
        return { ok: false, code: 'api_read_only', message: 'Este token es de sólo lectura: crea uno con «Leer y escribir» para hacer cambios.' };
    }
    return { ok: true };
}

/**
 * Freno por token y por empresa: el límite general es por IP, y n8n o un
 * script con muchos pasos llaman desde la misma IP muchas veces. Ventana fija
 * de un minuto en Redis, compartida entre servidores. Si Redis no responde,
 * no se bloquea (la base tiene su propio tope de conexiones).
 */
export function apiTokenLimits(env: NodeJS.ProcessEnv = process.env): { perToken: number; perTenant: number } {
    const read = (v: string | undefined, d: number): number => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : d;
    };
    return { perToken: read(env.API_TOKEN_PER_MINUTE, 300), perTenant: read(env.API_TENANT_PER_MINUTE, 1200) };
}

export interface ApiBudgetResult {
    ok: boolean;
    retryAfter?: number;
    limit?: number;
    remaining?: number;
}

export async function checkApiBudget(
    redis: IncrRedis,
    who: { tokenId: number; tenantId: number },
    limits = apiTokenLimits(),
    now = Date.now(),
): Promise<ApiBudgetResult> {
    const minute = Math.floor(now / 60_000);
    const retryAfter = 60 - Math.floor((now % 60_000) / 1000);
    try {
        const tok = await incrWithTtl(redis, `apibud:t:${who.tokenId}:${minute}`, 70);
        if (tok > limits.perToken) return { ok: false, retryAfter, limit: limits.perToken, remaining: 0 };
        const ten = await incrWithTtl(redis, `apibud:w:${who.tenantId}:${minute}`, 70);
        if (ten > limits.perTenant) return { ok: false, retryAfter, limit: limits.perTenant, remaining: 0 };
        return { ok: true, retryAfter, limit: limits.perToken, remaining: Math.max(0, limits.perToken - tok) };
    } catch {
        return { ok: true };
    }
}
