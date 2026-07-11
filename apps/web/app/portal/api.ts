/**
 * Cliente fetch de los bloques del portal contra `boot.rest_root/portal/*`.
 *
 *  - Manda credenciales (cookie de sesión del portal) — exige autenticación.
 *  - Sin cache en memoria — las respuestas del portal pueden cambiar en
 *    cualquier momento por updates del admin.
 *
 * Nota: varios de estos endpoints (`/portal/me/comments`, `…/activity`,
 * `…/aggregates`, `…/records`) aún no existen en el backend — los bloques
 * que los usan solo corren en el preview del editor (boot mock, sin red).
 */

import type {
    PortalBootData,
    PortalMeResponse,
    PortalRecordsResponse,
} from './types';

export async function fetchMe(boot: PortalBootData, signal?: AbortSignal): Promise<PortalMeResponse> {
    const url = `${boot.rest_root.replace(/\/$/, '')}/portal/me`;
    return doFetch<PortalMeResponse>(url, signal);
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
    return doFetch<PortalRecordsResponse>(`${base}?${q.toString()}`, signal);
}

async function doFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(url, {
        signal,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
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
