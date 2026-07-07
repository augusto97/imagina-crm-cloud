/**
 * Cliente fetch minimalista contra el REST público (Fase 8 — 2.C).
 *
 * Sin TanStack Query (peso) y sin axios (peso). Cache en memoria
 * con la URL como key — durante la sesión del visitante, navegar
 * entre páginas/sort no re-pega al backend para combinaciones ya
 * vistas (importante porque el endpoint puede tener TTL bajo).
 */

import type { FetchParams, PublicInitialPayload, PublicListConfig } from './types';

const cache = new Map<string, PublicInitialPayload>();

export interface FetchResult {
    payload: PublicInitialPayload;
    fromCache: boolean;
}

export async function fetchPage(
    config: PublicListConfig,
    params: FetchParams,
    signal?: AbortSignal,
): Promise<FetchResult> {
    const url = buildUrl(config, params);

    const cached = cache.get(url);
    if (cached !== undefined) {
        return { payload: cached, fromCache: true };
    }

    const res = await fetch(url, {
        signal,
        // No mandamos cookies — el endpoint público es anónimo y
        // queremos que sea cacheable por CDN/browser sin variar
        // por cookie.
        credentials: 'omit',
        headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
        if (res.status === 429) {
            throw new Error('rate-limited');
        }
        throw new Error(`HTTP ${res.status}`);
    }

    const json = (await res.json()) as PublicInitialPayload;
    cache.set(url, json);
    return { payload: json, fromCache: false };
}

function buildUrl(config: PublicListConfig, params: FetchParams): string {
    const base = config.rest_root.replace(/\/$/, '');
    const q = new URLSearchParams();
    q.set('page', String(params.page));
    q.set('per_page', String(config.per_page));
    if (params.search.trim() !== '') {
        q.set('search', params.search.trim());
    }
    if (params.sort !== null) {
        q.set('sort', `${params.sort.slug}:${params.sort.dir}`);
    }
    // filter[slug][op]=value — el backend acepta `eq` por default si
    // se pasa el value directo. Para arrays (multi_select), usamos `in`.
    // Fase 12.E.
    for (const [slug, value] of Object.entries(params.filters)) {
        if (value === '' || value == null) continue;
        if (value.includes(',')) {
            q.append(`filter[${slug}][in]`, value);
        } else {
            q.append(`filter[${slug}][eq]`, value);
        }
    }
    return `${base}/public/lists/${encodeURIComponent(config.slug)}/records?${q.toString()}`;
}
