import { getBootData } from '@/lib/boot';
import { CLOUD_WIRED } from '@/lib/cloudFeatures';

/**
 * Error tipado que devuelve la REST API. Mapea el shape estándar:
 *
 *     { code, message, data: { status, errors? } }
 */
export class ApiError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly errors: Record<string, string>;

    constructor(message: string, status: number, code: string, errors: Record<string, string> = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.errors = errors;
    }
}

export interface SlugRenamedHint {
    old: string;
    new: string;
}

export interface ApiResponse<T> {
    data: T;
    meta?: Record<string, unknown>;
    slugRenamed?: SlugRenamedHint;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
    query?: Record<string, unknown>;
    body?: unknown;
    signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
    const boot = getBootData();
    const base = boot.restRoot.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${base}${cleanPath}`;

    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        appendParam(params, key, value);
    }

    const qs = params.toString();
    if (qs) {
        url += url.includes('?') ? '&' : '?';
        url += qs;
    }
    return url;
}

function serializeParam(value: unknown): string {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (Array.isArray(value)) return value.map(String).join(',');
    return String(value);
}

/**
 * Serializa recursivamente cada par key/value al estilo PHP/WP-REST,
 * soportando anidamiento arbitrario:
 *   { filter: { field_5: { eq: 'won' } } } → filter[field_5][eq]=won
 *
 * Antes esta función solo manejaba UN nivel — el segundo nivel
 * (`{eq: 'won'}`) terminaba como `String(obj)` = `"[object Object]"`,
 * lo que rompía TODOS los filtros silenciosamente.
 */
function appendParam(params: URLSearchParams, key: string, value: unknown): void {
    if (value === undefined || value === null) return;

    if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
            appendParam(params, `${key}[${innerKey}]`, innerValue);
        }
        return;
    }

    params.append(key, serializeParam(value));
}

function parseSlugRename(header: string | null): SlugRenamedHint | undefined {
    if (!header) return undefined;
    const out: Partial<SlugRenamedHint> = {};
    for (const part of header.split(',')) {
        const [k, v] = part.split('=');
        if (k && v) {
            const key = k.trim();
            const val = v.trim();
            if (key === 'old') out.old = val;
            if (key === 'new') out.new = val;
        }
    }
    return out.old !== undefined && out.new !== undefined ? (out as SlugRenamedHint) : undefined;
}

// --- Adaptación de shape en modo nube (Imagina Base) -----------------------
// El backend NestJS y el fork WP no comparten exactamente el mismo shape.
// Estas funciones traducen SOLO en modo cloud (`boot.cloud`), dejando el
// build WordPress intacto. Deltas cubiertos: envelope inconsistente, record
// `data`↔`fields`, paginación cursor→página, y body `{fields}`→`{data}`.

/** ¿El path apunta al recurso records (listado o item), no bulk/groups? */
function recordsPathKind(path: string): 'list' | 'item' | null {
    if (/\/lists\/[^/]+\/records\/\d+$/.test(path)) return 'item';
    if (/\/lists\/[^/]+\/records$/.test(path)) return 'list';
    return null;
}

/** Segmento `:listIdOrSlug` de un path `/lists/<key>/...`. */
function listKeyFromPath(path: string): string | null {
    const m = path.match(/\/lists\/([^/]+)/);
    return m?.[1] ?? null;
}

const CLOUD_RECORDS_MAX_LIMIT = 200; // espejo de MAX_RECORDS_LIMIT del backend.

/**
 * Traduce la query de listado de records de la UI (por página: `per_page`/`page`)
 * a la del backend (por cursor: `limit`, máx 200). Deja pasar el resto de la
 * query (filter_tree, sort, search…). `page` se descarta: la paginación es por
 * cursor keyset, no por offset.
 */
function cloudRecordsQuery(query?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!query) return query;
    const { per_page, page, limit, ...rest } = query;
    const desired = Number(per_page ?? limit ?? 0);
    const out: Record<string, unknown> = { ...rest };
    if (Number.isFinite(desired) && desired > 0) {
        out.limit = Math.min(desired, CLOUD_RECORDS_MAX_LIMIT);
    }
    void page;
    return out;
}

/**
 * Mapa de traducción de claves de un record para una lista. El backend keyea
 * los valores por `f{field_id}` (ADR-S02, verdad interna); la UI del fork los
 * consume por SLUG (`row.fields[field.slug]`). Guardamos ambos sentidos.
 */
interface FieldKeyMap {
    toSlug: Record<string, string>; // f{id} → slug
    toFid: Record<string, string>; // slug → f{id}
}

// Cache por lista (clave = segmento del path, id o slug). Se puebla desde las
// respuestas del endpoint `/fields` (que la UI siempre carga) y, como respaldo,
// con un fetch on-demand. Se refresca en cada GET de fields → nunca queda stale.
const fieldMaps = new Map<string, FieldKeyMap>();

function buildFieldMap(fields: unknown): FieldKeyMap {
    const toSlug: Record<string, string> = {};
    const toFid: Record<string, string> = {};
    if (Array.isArray(fields)) {
        for (const f of fields as Array<{ id?: number; slug?: string }>) {
            if (typeof f.id === 'number' && typeof f.slug === 'string') {
                toSlug[`f${f.id}`] = f.slug;
                toFid[f.slug] = `f${f.id}`;
            }
        }
    }
    return { toSlug, toFid };
}

/** Devuelve el mapa de campos de una lista (cache → fetch on-demand). */
async function ensureFieldMap(listKey: string): Promise<FieldKeyMap> {
    const cached = fieldMaps.get(listKey);
    if (cached) return cached;
    try {
        const boot = getBootData();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
        const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/lists/${listKey}/fields`, {
            headers,
            credentials: 'include',
        });
        const payload = res.ok ? await res.json().catch(() => null) : null;
        const map = buildFieldMap((payload as { data?: unknown } | null)?.data);
        fieldMaps.set(listKey, map);
        return map;
    } catch {
        return { toSlug: {}, toFid: {} };
    }
}

/** RecordDto backend (`data` con claves f{id}) → RecordEntity UI (`fields` por slug). */
function mapRecord(raw: unknown, map: FieldKeyMap): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const r = raw as Record<string, unknown>;
    const source = (r.data as Record<string, unknown> | undefined) ?? {};
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) {
        fields[map.toSlug[k] ?? k] = v; // f{id} → slug (fallback: deja la clave)
    }
    return {
        id: r.id,
        fields,
        relations: (r.relations as Record<string, unknown>) ?? {},
        created_by: r.created_by,
        // El fork asume timestamps naive-UTC (les concatena 'Z' al formatear,
        // herencia del plugin WP). El backend nuevo devuelve ISO con 'Z' → la
        // quitamos para no producir '...ZZ' (Invalid Date).
        created_at: stripZ(r.created_at),
        updated_at: stripZ(r.updated_at),
    };
}

function stripZ(value: unknown): unknown {
    return typeof value === 'string' ? value.replace(/Z$/, '') : value;
}

/** Body de create/update: `{fields:{slug:v}}` UI → `{data:{f{id}:v}}` backend. */
function mapRecordBody(body: unknown, map: FieldKeyMap): unknown {
    if (!body || typeof body !== 'object') return body;
    const b = body as Record<string, unknown>;
    const src = (b.fields as Record<string, unknown> | undefined) ?? (b.data as Record<string, unknown> | undefined);
    if (!src) return body;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
        data[map.toFid[k] ?? k] = v; // slug → f{id} (fallback: deja la clave)
    }
    return { data };
}

/**
 * Normaliza la respuesta del backend NestJS al `{ data, meta }` que espera la
 * UI: envelope inconsistente, records con claves f{id}→slug y paginación
 * cursor→página.
 */
async function normalizeCloudResponse<T>(path: string, payload: unknown): Promise<ApiResponse<T>> {
    const kind = recordsPathKind(path);

    if (kind !== null) {
        const listKey = listKeyFromPath(path) ?? '';
        const map = await ensureFieldMap(listKey);
        if (kind === 'item') {
            return { data: mapRecord(payload, map) as T };
        }
        const env = (payload ?? {}) as { data?: unknown; meta?: Record<string, unknown> };
        const rows = Array.isArray(env.data) ? env.data.map((r) => mapRecord(r, map)) : [];
        // La UI pagina por páginas; el backend por cursor keyset. En esta etapa
        // servimos la tanda tal cual con total_pages=1 (sin waterfalls); la
        // paginación cursor completa llega en una etapa posterior.
        return {
            data: rows as T,
            meta: {
                page: 1,
                per_page: rows.length,
                total: rows.length,
                total_pages: 1,
                next_cursor: env.meta?.next_cursor ?? null,
            },
        };
    }

    // Widget data de dashboards: el payload ES la WidgetData y puede tener un
    // `data` propio (charts: `{data:[…]}`). NO lo desenvolvemos (si no, el chart
    // pierde su `.data`); lo devolvemos tal cual bajo `res.data`.
    if (/\/widgets\/[^/]+\/data$/.test(path)) {
        return { data: payload as T };
    }

    // Bundle de widgets (PERF-03): `{ [widgetId]: WidgetData }`. Igual que el
    // single-widget, se devuelve tal cual (cada WidgetData chart tiene su `.data`).
    if (/\/widgets\/data$/.test(path)) {
        return { data: payload as T };
    }

    // Endpoint de fields: cacheamos el mapa de la lista (lo usan los records).
    if (/\/lists\/[^/]+\/fields$/.test(path)) {
        const listKey = listKeyFromPath(path);
        const arr = (payload as { data?: unknown } | null)?.data;
        if (listKey) fieldMaps.set(listKey, buildFieldMap(arr));
    }

    // Genérico: enveloped (`{data}`) → desenvolver; objeto crudo → envolver.
    if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
        const env = payload as { data?: unknown; meta?: Record<string, unknown> };
        return { data: normalizeDates(env.data) as T, meta: env.meta };
    }
    return { data: normalizeDates(payload) as T };
}

/**
 * Quita la `Z` de los timestamps `*_at` (naive-UTC, como el plugin) en objetos
 * de nivel superior o arrays de objetos (listas, fields, views…). El fork les
 * concatena 'Z' al formatear; sin esto verían '...ZZ' → Invalid Date.
 */
function normalizeDates(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeDates);
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const out: Record<string, unknown> = { ...obj };
        for (const [k, v] of Object.entries(obj)) {
            if (/_at$/.test(k) && typeof v === 'string') out[k] = v.replace(/Z$/, '');
        }
        return out;
    }
    return value;
}

/**
 * Módulos aún no cableados al backend NestJS: en vez de dejar que la UI dispare
 * requests que devuelven 404/400 (ruido en consola y secciones que parecen
 * rotas), devolvemos un vacío seguro. Cada stub se apaga solo al poner el
 * módulo en `true` en CLOUD_WIRED (cuando se conecta de verdad).
 */
function cloudStub(method: Method, path: string): { data: unknown } | null {
    if (method !== 'GET') return null;
    // Ojo: algunos hooks embeben el query string en el path (…/aggregates?fields=…),
    // así que matcheamos permitiendo un `?` o fin de string.
    if (!CLOUD_WIRED.aggregates && /\/records\/aggregates(\?|$)/.test(path)) return { data: { totals: {} } };
    if (!CLOUD_WIRED.recurrences && /\/recurrences(\?|$)/.test(path)) return { data: [] };
    if (!CLOUD_WIRED.dashboards && /^\/dashboards(\/|\?|$)/.test(path)) return { data: [] };
    if (!CLOUD_WIRED.mentions && /\/me\/mentions(\?|$)/.test(path)) return { data: [] };
    if (!CLOUD_WIRED.automations && /^\/(triggers|actions)(\?|$)/.test(path)) return { data: [] };
    return null;
}

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
    const boot = getBootData();
    if (boot.cloud) {
        const stub = cloudStub(method, path);
        if (stub) return { data: stub.data as T };
    }
    // En la nube, el listado de records pagina por CURSOR con `limit` (máx 200),
    // pero la UI del fork manda `per_page`/`page`. Traducimos `per_page → limit`
    // (capado a 200) para que Kanban/Tarjetas/Calendario —que piden per_page=500—
    // traigan más de los 50 por defecto en vez de quedarse cortos.
    const query =
        boot.cloud && method === 'GET' && recordsPathKind(path) === 'list'
            ? cloudRecordsQuery(opts.query)
            : opts.query;
    const url = buildUrl(path, query);

    const headers: Record<string, string> = {
        Accept: 'application/json',
    };
    // Auth: en la nube, cookie de sesión + tenant activo; en WP, nonce.
    if (boot.cloud) {
        if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
    } else if (boot.restNonce) {
        headers['X-WP-Nonce'] = boot.restNonce;
    }

    let body: BodyInit | undefined;
    if (opts.body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        let payload: unknown = opts.body;
        if (boot.cloud && recordsPathKind(path) !== null) {
            const map = await ensureFieldMap(listKeyFromPath(path) ?? '');
            payload = mapRecordBody(opts.body, map);
        }
        body = JSON.stringify(payload);
    }

    const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: boot.cloud ? 'include' : 'same-origin',
        signal: opts.signal,
    });

    const contentType = response.headers.get('Content-Type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
        const message =
            (payload && typeof payload === 'object' && 'message' in payload && String(payload.message)) ||
            `HTTP ${response.status}`;
        const code =
            (payload && typeof payload === 'object' && 'code' in payload && String(payload.code)) ||
            'imcrm_http_error';
        const errors =
            (payload && typeof payload === 'object' && 'data' in payload &&
                typeof (payload as Record<string, unknown>).data === 'object' &&
                ((payload as { data?: { errors?: Record<string, string> } }).data?.errors ?? {})) ||
            {};
        throw new ApiError(message, response.status, code, errors);
    }

    const slugRenamed = parseSlugRename(response.headers.get('X-Imagina-CRM-Slug-Renamed'));

    // Modo nube: normalizamos el shape del backend NestJS.
    if (boot.cloud) {
        const normalized = await normalizeCloudResponse<T>(path, payload);
        return { ...normalized, slugRenamed };
    }

    // Modo WordPress (build del plugin): envelope `{data, meta}` garantizado.
    if (payload === null || typeof payload !== 'object') {
        return { data: undefined as unknown as T };
    }
    const envelope = payload as { data?: unknown; meta?: Record<string, unknown> };
    return {
        data: envelope.data as T,
        meta: envelope.meta,
        slugRenamed,
    };
}

export const api = {
    get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
    post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
        request<T>('POST', path, { ...opts, body }),
    patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
        request<T>('PATCH', path, { ...opts, body }),
    delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
