import { safeWebhookFetch } from '../../common/safe-fetch';
import type { IntegrationCreds } from '../../connectors/integration-calls';
import { checkWooResponse, wooHeaders, wooUrl } from '../../connectors/woocommerce/wc-api';
import { redactValues } from '../../connectors/connection-parts';
import type { WooJson } from './woo-map';

/**
 * Lectura de la API de una tienda para la sincronización (v0.1.206). Lo único
 * con red de la fase 2 — las URLs y cabeceras salen de `wc-api` (las mismas de
 * las acciones), y el guard anti-SSRF de siempre (SEC-03) sigue en el medio.
 */

export class WooApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export interface WooPage {
    rows: WooJson[];
    total: number | null;
    totalPages: number | null;
}

/** 100 es el máximo que acepta la API REST de WooCommerce por página. */
export const WOO_PAGE_SIZE = 100;
/** Una página de 100 pedidos con sus líneas y meta pesa cientos de KB. */
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headerInt(headers: Record<string, string> | undefined, name: string): number | null {
    const v = headers?.[name];
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * GET con reintentos para lo pasajero (5xx, 429, red): una tienda en un
 * hosting compartido falla de a ratos y un corte a mitad de un import de miles
 * de pedidos no tiene que tirar todo. Un 4xx de verdad (clave rechazada) no se
 * reintenta: el motivo va directo a la pantalla.
 */
export async function wooGet(
    creds: IntegrationCreds,
    path: string,
    query: Array<[string, string]> = [],
): Promise<{ json: unknown; headers: Record<string, string> }> {
    const url = wooUrl(creds, path, query);
    const hide = [creds.secret, creds.fields.consumer_key ?? ''].filter((s) => s.length >= 4);
    let lastError = '';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1));
        let res;
        try {
            res = await safeWebhookFetch(url, {
                method: 'GET',
                headers: wooHeaders(creds),
                captureBody: true,
                maxCaptureBytes: MAX_PAGE_BYTES,
                timeoutMs: 60_000,
            });
        } catch (err) {
            lastError = redactValues(err instanceof Error ? err.message : String(err), hide);
            // El guard anti-SSRF no es pasajero: no tiene sentido reintentar.
            if (/SSRF|no permitido|inválida/.test(lastError)) break;
            continue;
        }
        if (res.status === 429 || res.status >= 500) {
            lastError = `la tienda respondió ${res.status}`;
            const retryAfter = headerInt(res.headers, 'retry-after');
            if (retryAfter !== null) await sleep(Math.min(retryAfter, 30) * 1000);
            continue;
        }
        const problem = checkWooResponse(res.status, res.body ?? '');
        if (problem) throw new WooApiError(problem, res.status);
        if (res.truncated) {
            throw new WooApiError('La respuesta de la tienda es demasiado grande para leerla de una vez.', 413);
        }
        try {
            return { json: JSON.parse(res.body ?? 'null') as unknown, headers: res.headers ?? {} };
        } catch {
            throw new WooApiError('La tienda respondió algo que no es la API (no es JSON).', res.status);
        }
    }
    throw new WooApiError(`No pudimos leer la tienda: ${lastError || 'sin respuesta'}.`, 0);
}

/** Una página de una colección (`/products`, `/orders`…). */
export async function wooGetPage(
    creds: IntegrationCreds,
    path: string,
    query: Array<[string, string]>,
): Promise<WooPage> {
    const { json, headers } = await wooGet(creds, path, query);
    if (!Array.isArray(json)) throw new WooApiError('La tienda no devolvió una lista donde se esperaba una.', 200);
    return {
        rows: json.filter((r): r is WooJson => r !== null && typeof r === 'object' && !Array.isArray(r)),
        total: headerInt(headers, 'x-wp-total'),
        totalPages: headerInt(headers, 'x-wp-totalpages'),
    };
}

/**
 * Escritura en la tienda (v0.1.207): alta/baja de avisos y la edición en los
 * dos sentidos. SIN reintentos a ciegas: un PUT repetido es inocuo, pero un
 * POST de un aviso repetido crearía dos; el que llama decide.
 */
export async function wooSend(
    creds: IntegrationCreds,
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: Record<string, unknown> | null,
    query: Array<[string, string]> = [],
): Promise<unknown> {
    const url = wooUrl(creds, path, query);
    const hide = [creds.secret, creds.fields.consumer_key ?? ''].filter((s) => s.length >= 4);
    let res;
    try {
        res = await safeWebhookFetch(url, {
            method,
            headers: wooHeaders(creds, body !== null),
            body: body === null ? undefined : JSON.stringify(body),
            captureBody: true,
            maxCaptureBytes: MAX_PAGE_BYTES,
            timeoutMs: 30_000,
        });
    } catch (err) {
        throw new WooApiError(`No pudimos hablar con la tienda: ${redactValues(err instanceof Error ? err.message : String(err), hide)}.`, 0);
    }
    const problem = checkWooResponse(res.status, res.body ?? '');
    if (problem) throw new WooApiError(problem, res.status);
    try {
        return JSON.parse(res.body ?? 'null') as unknown;
    } catch {
        return null;
    }
}
