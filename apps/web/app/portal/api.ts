/**
 * Cliente fetch contra `/imagina-crm/v1/portal/*` (Fase 9 — 3.D).
 *
 * Distinto del cliente del bundle público de Fase 8:
 *  - Manda credenciales (cookies WP) — el portal exige autenticación.
 *  - Envía el `X-WP-Nonce` que el shortcode inyectó vía
 *    `data-imcrm-portal-boot`.
 *  - Sin cache en memoria — las respuestas del portal pueden cambiar
 *    en cualquier momento por updates del admin.
 */

import type {
    PortalBootData,
    PortalMeResponse,
    PortalRecordsResponse,
} from './types';

export async function fetchMe(boot: PortalBootData, signal?: AbortSignal): Promise<PortalMeResponse> {
    const url = `${boot.rest_root.replace(/\/$/, '')}/portal/me`;
    return doFetch<PortalMeResponse>(url, boot, signal);
}

export async function fetchRelatedRecords(
    boot: PortalBootData,
    listSlug: string,
    params: { page?: number; per_page?: number },
    signal?: AbortSignal,
): Promise<PortalRecordsResponse> {
    const base = `${boot.rest_root.replace(/\/$/, '')}/portal/lists/${encodeURIComponent(listSlug)}/records`;
    const q = new URLSearchParams();
    q.set('page', String(params.page ?? 1));
    if (params.per_page !== undefined) q.set('per_page', String(params.per_page));
    return doFetch<PortalRecordsResponse>(`${base}?${q.toString()}`, boot, signal);
}

async function doFetch<T>(url: string, boot: PortalBootData, signal?: AbortSignal): Promise<T> {
    const res = await fetch(url, {
        signal,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'X-WP-Nonce': boot.rest_nonce,
        },
    });
    if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
            throw new Error('not-authorized');
        }
        if (res.status === 404) {
            throw new Error('not-found');
        }
        throw new Error(`http-${res.status}`);
    }
    return (await res.json()) as T;
}
