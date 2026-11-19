import {
    AIRTABLE_REQUIRED_SCOPES,
    type AirtableBaseInfo,
    type AirtableFieldSchema,
    type AirtableTableSchema,
} from '@imagina-base/shared';
import { safeWebhookFetch, type SafeFetchOptions, type SafeFetchResult } from '../common/safe-fetch';

/**
 * v0.1.458 — Cliente de la API de Airtable para la importación.
 *
 *  - Por la MISMA salida protegida que los webhooks (anti-SSRF, SEC-03): la
 *    base de la API es fija en producción (`api.airtable.com`) y sólo los
 *    tests y el entorno de desarrollo la cambian con `AIRTABLE_API_URL`.
 *  - Airtable permite 5 pedidos por segundo por base: el cliente deja al menos
 *    220 ms entre pedidos y, ante un 429, espera lo que pide `Retry-After`
 *    (30 s si no lo dice) y reintenta. Un 5xx o la red caída se reintentan
 *    con espera creciente.
 *  - Los errores salen en lenguaje claro (el token, los permisos, la base).
 *  - El token NUNCA va a un mensaje de error ni a un registro.
 */

export class AirtableApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export interface AirtableRecord {
    id: string;
    createdTime: string;
    fields: Record<string, unknown>;
}

export type AirtableFetch = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResult>;

export interface AirtableClientOptions {
    baseUrl: string;
    token: string;
    /** Espera mínima entre pedidos (220 ms: menos de 5 por segundo). */
    minIntervalMs?: number;
    /** Reintentos ante un 429 o un error pasajero. */
    maxRetries?: number;
    /** Se puede cambiar en los tests. */
    sleep?: (ms: number) => Promise<void>;
    fetch?: AirtableFetch;
    /** Se cortó la importación: los reintentos dejan de esperar. */
    aborted?: () => boolean;
}

const PAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_RETRY_AFTER_MS = 30_000;
const MAX_RETRY_WAIT_MS = 60_000;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class AirtableClient {
    private readonly base: string;
    private readonly minInterval: number;
    private readonly maxRetries: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly fetcher: AirtableFetch;
    private last = 0;
    /** Pedidos hechos y esperas por 429 (para el resumen y los tests). */
    readonly stats = { requests: 0, rate_limited: 0 };

    constructor(private readonly opts: AirtableClientOptions) {
        this.base = opts.baseUrl.replace(/\/+$/, '');
        this.minInterval = opts.minIntervalMs ?? 220;
        this.maxRetries = opts.maxRetries ?? 6;
        this.sleep = opts.sleep ?? realSleep;
        this.fetcher = opts.fetch ?? safeWebhookFetch;
    }

    /** Quién es el token y qué permisos tiene (`scopes` puede no venir en tokens viejos). */
    async whoami(): Promise<{ id: string; scopes: string[] | null }> {
        const body = (await this.get('/v0/meta/whoami', 'whoami')) as { id?: unknown; scopes?: unknown };
        return {
            id: typeof body.id === 'string' ? body.id : '',
            scopes: Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === 'string') : null,
        };
    }

    /** Los permisos que le faltan al token (vacío = tiene todo o no se sabe). */
    static missingScopes(scopes: string[] | null): string[] {
        if (scopes === null) return [];
        return AIRTABLE_REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    }

    async bases(): Promise<AirtableBaseInfo[]> {
        const out: AirtableBaseInfo[] = [];
        let offset: string | undefined;
        for (let guard = 0; guard < 50; guard++) {
            const q = offset ? `?offset=${encodeURIComponent(offset)}` : '';
            const body = (await this.get(`/v0/meta/bases${q}`, 'bases')) as { bases?: unknown; offset?: unknown };
            for (const b of Array.isArray(body.bases) ? body.bases : []) {
                const o = b as Record<string, unknown>;
                if (typeof o.id === 'string' && typeof o.name === 'string') out.push({ id: o.id, name: o.name });
            }
            offset = typeof body.offset === 'string' ? body.offset : undefined;
            if (!offset) break;
        }
        return out;
    }

    async tables(baseId: string): Promise<AirtableTableSchema[]> {
        const body = (await this.get(`/v0/meta/bases/${encodeURIComponent(baseId)}/tables`, 'tables')) as { tables?: unknown };
        const out: AirtableTableSchema[] = [];
        for (const raw of Array.isArray(body.tables) ? body.tables : []) {
            const t = raw as Record<string, unknown>;
            if (typeof t.id !== 'string' || typeof t.name !== 'string') continue;
            const fields: AirtableFieldSchema[] = [];
            for (const fr of Array.isArray(t.fields) ? t.fields : []) {
                const f = fr as Record<string, unknown>;
                if (typeof f.id !== 'string' || typeof f.type !== 'string') continue;
                fields.push({
                    id: f.id,
                    name: typeof f.name === 'string' ? f.name : f.id,
                    type: f.type,
                    ...(typeof f.description === 'string' ? { description: f.description } : {}),
                    ...(f.options && typeof f.options === 'object' ? { options: f.options as Record<string, unknown> } : {}),
                });
            }
            const primary = typeof t.primaryFieldId === 'string' ? t.primaryFieldId : (fields[0]?.id ?? '');
            out.push({ id: t.id, name: t.name, primaryFieldId: primary, fields, ...(typeof t.description === 'string' ? { description: t.description } : {}) });
        }
        return out;
    }

    /** Una página de registros (hasta 100) con los valores por id de campo. */
    async page(baseId: string, tableId: string, offset: string | undefined, fieldIds: readonly string[]): Promise<{ records: AirtableRecord[]; offset?: string }> {
        const params = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
        for (const f of fieldIds) params.append('fields[]', f);
        if (offset) params.set('offset', offset);
        const body = (await this.get(`/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${params.toString()}`, 'records')) as {
            records?: unknown;
            offset?: unknown;
        };
        const records: AirtableRecord[] = [];
        for (const raw of Array.isArray(body.records) ? body.records : []) {
            const r = raw as Record<string, unknown>;
            if (typeof r.id !== 'string') continue;
            records.push({
                id: r.id,
                createdTime: typeof r.createdTime === 'string' ? r.createdTime : '',
                fields: r.fields && typeof r.fields === 'object' ? (r.fields as Record<string, unknown>) : {},
            });
        }
        return { records, offset: typeof body.offset === 'string' && body.offset !== '' ? body.offset : undefined };
    }

    private async throttle(): Promise<void> {
        const wait = this.last + this.minInterval - Date.now();
        if (wait > 0) await this.sleep(wait);
        this.last = Date.now();
    }

    private async get(path: string, what: 'whoami' | 'bases' | 'tables' | 'records'): Promise<unknown> {
        let attempt = 0;
        for (;;) {
            await this.throttle();
            this.stats.requests++;
            let res: SafeFetchResult;
            try {
                res = await this.fetcher(`${this.base}${path}`, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${this.opts.token}`, Accept: 'application/json' },
                    captureBody: true,
                    maxCaptureBytes: PAGE_BYTES,
                    timeoutMs: 20_000,
                });
            } catch {
                if (attempt++ < this.maxRetries && !this.opts.aborted?.()) {
                    await this.sleep(Math.min(1000 * 2 ** attempt, 20_000));
                    continue;
                }
                throw new AirtableApiError('airtable_unreachable', 'No se pudo conectar con Airtable. Revisa tu conexión e intenta de nuevo en unos minutos.', 502);
            }
            if (res.status === 429 || res.status >= 500) {
                if (res.status === 429) this.stats.rate_limited++;
                if (attempt++ < this.maxRetries && !this.opts.aborted?.()) {
                    const after = Number(res.headers?.['retry-after']);
                    const wait = res.status === 429 ? (Number.isFinite(after) && after >= 0 ? after * 1000 : DEFAULT_RETRY_AFTER_MS) : Math.min(1000 * 2 ** attempt, 20_000);
                    await this.sleep(Math.min(wait, MAX_RETRY_WAIT_MS));
                    continue;
                }
                throw res.status === 429
                    ? new AirtableApiError('airtable_rate_limited', 'Airtable está limitando los pedidos de esta base. Espera unos minutos e intenta de nuevo.', 429)
                    : new AirtableApiError('airtable_unavailable', 'Airtable no respondió bien. Intenta de nuevo en unos minutos.', 502);
            }
            if (res.truncated) throw new AirtableApiError('airtable_too_big', 'Airtable devolvió una respuesta demasiado grande.', 502);
            let body: unknown = null;
            try {
                body = res.body ? JSON.parse(res.body) : null;
            } catch {
                body = null;
            }
            if (res.status >= 200 && res.status < 300 && body && typeof body === 'object') return body;
            throw explain(res.status, body, what);
        }
    }
}

function explain(status: number, body: unknown, what: 'whoami' | 'bases' | 'tables' | 'records'): AirtableApiError {
    const err = (body as { error?: unknown } | null)?.error;
    const type = typeof err === 'string' ? err : typeof (err as { type?: unknown })?.type === 'string' ? (err as { type: string }).type : '';
    if (status === 401) {
        return new AirtableApiError('airtable_token_invalid', 'Airtable no reconoce ese token: revisa que lo copiaste completo y que no esté vencido ni revocado.', 400);
    }
    if (status === 403 || type === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND' || type === 'INVALID_PERMISSIONS') {
        if (what === 'records') {
            return new AirtableApiError('airtable_missing_scope', 'El token no puede leer los registros: agrégale el permiso «data.records:read» y el acceso a esta base.', 400);
        }
        if (what === 'tables') {
            return new AirtableApiError('airtable_no_base_access', 'El token no tiene acceso a esa base: en Airtable, agrégala en «Access» del token.', 400);
        }
        return new AirtableApiError('airtable_missing_scope', 'Al token le falta el permiso «schema.bases:read»: agrégaselo en Airtable y vuelve a pegarlo.', 400);
    }
    if (status === 404) {
        return new AirtableApiError('airtable_not_found', what === 'records' || what === 'tables' ? 'Airtable no encontró esa base o tabla: puede que la hayan borrado o que el token no tenga acceso.' : 'Airtable no encontró lo que se pidió.', 404);
    }
    if (status === 422) return new AirtableApiError('airtable_invalid_request', 'Airtable no aceptó el pedido.', 502);
    return new AirtableApiError('airtable_error', `Airtable respondió con un error (${status}).`, 502);
}
