import { getBootData } from '@/lib/boot';

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

async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
    const boot = getBootData();
    const url = buildUrl(path, opts.query);

    const headers: Record<string, string> = {
        'X-WP-Nonce': boot.restNonce,
        Accept: 'application/json',
    };

    let body: BodyInit | undefined;
    if (opts.body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
    }

    const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: 'same-origin',
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

    if (payload === null || typeof payload !== 'object') {
        return { data: undefined as unknown as T };
    }

    const slugRenamed = parseSlugRename(response.headers.get('X-Imagina-CRM-Slug-Renamed'));

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
