import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
    IDataObject,
    IExecuteFunctions,
    IHookFunctions,
    IHttpRequestMethods,
    IHttpRequestOptions,
    ILoadOptionsFunctions,
    JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { apiBase, type ApiField, type ApiRecord } from './fields';

export const CREDENTIAL = 'imaginaBaseApi';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

/**
 * Un pedido a la API con el token de la credencial. Los errores de la app
 * (`{ code, message }`) se muestran con su mensaje, que ya viene en palabras.
 */
export async function apiRequest(
    this: Ctx,
    method: IHttpRequestMethods,
    path: string,
    body?: IDataObject,
    qs?: IDataObject,
): Promise<any> {
    const creds = await this.getCredentials(CREDENTIAL);
    const options: IHttpRequestOptions = {
        method,
        url: `${apiBase(String(creds.baseUrl ?? ''))}${path}`,
        json: true,
    };
    if (body !== undefined) options.body = body;
    if (qs && Object.keys(qs).length) options.qs = qs;
    try {
        return await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, options);
    } catch (error) {
        const e = error as { response?: { body?: { message?: string; code?: string } }; cause?: { response?: { data?: { message?: string } } } };
        const message = e.response?.body?.message ?? e.cause?.response?.data?.message;
        throw new NodeApiError(this.getNode(), error as JsonObject, message ? { message } : {});
    }
}

/** El id o el nombre interno de una lista, listo para ir en la ruta. */
export function listRef(v: unknown): string {
    return encodeURIComponent(String(v ?? '').trim());
}

/** Los campos de una lista (con su id, nombre interno y tipo). */
export async function loadFields(this: Ctx, list: unknown): Promise<ApiField[]> {
    const res = (await apiRequest.call(this, 'GET', `/lists/${listRef(list)}/fields`)) as { data?: ApiField[] };
    return res.data ?? [];
}

/**
 * Registros de una lista siguiendo el cursor. `limit` = cuántos como máximo
 * (`0` = todos).
 */
export async function listRecords(this: IExecuteFunctions, list: unknown, limit: number, qs: IDataObject): Promise<ApiRecord[]> {
    const out: ApiRecord[] = [];
    let cursor: string | undefined;
    do {
        const pageSize = limit > 0 ? Math.min(200, limit - out.length) : 200;
        const page = (await apiRequest.call(this, 'GET', `/lists/${listRef(list)}/records`, undefined, {
            ...qs,
            limit: pageSize,
            ...(cursor ? { cursor } : {}),
        })) as { data?: ApiRecord[]; meta?: { next_cursor?: string | null } };
        out.push(...(page.data ?? []));
        cursor = page.meta?.next_cursor ?? undefined;
    } while (cursor && (limit === 0 || out.length < limit));
    return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * Comprueba la firma de un aviso: `X-Webhook-Signature: t=<s>,v1=<hex>`, con
 * `v1 = HMAC-SHA256(secreto, "<t>.<cuerpo crudo>")`. Rechaza avisos de más de
 * `toleranceS` segundos (por defecto 5 min) para que no se puedan repetir.
 */
export function verifySignature(
    secret: string,
    header: string | undefined,
    rawBody: string,
    nowS = Math.floor(Date.now() / 1000),
    toleranceS = 300,
): boolean {
    if (!secret || !header) return false;
    const parts = Object.fromEntries(
        header.split(',').map((p) => {
            const i = p.indexOf('=');
            return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
        }),
    );
    const t = Number(parts.t);
    const v1 = String(parts.v1 ?? '');
    if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;
    if (Math.abs(nowS - t) > toleranceS) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
}
