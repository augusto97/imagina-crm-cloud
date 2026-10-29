import { safeWebhookFetch } from '../../common/safe-fetch';
import { redactValues } from '../../connectors/connection-parts';
import type { IntegrationCreds } from '../../connectors/integration-calls';
import { classifyWpResponse, wpHeaders, wpUrl, type WpErrorKind } from '../../connectors/wordpress/wp-api';
import type { WpJson } from './wp-map';

/**
 * Lectura y escritura de la API de un sitio WordPress para la sincronización
 * (v0.1.333, ADR-S83). Lo único con red del motor — las URLs, las cabeceras y
 * los motivos de error salen de `wp-api` (los mismos de la verificación), y el
 * guard anti-SSRF de siempre (SEC-03) sigue en el medio.
 */

export class WpApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly kind: WpErrorKind | 'network' = 'other',
        /** `code` y `data` del error de WordPress (p. ej. el `term_id` de un término que ya existe). */
        readonly wp: { code: string; data: Record<string, unknown> } = { code: '', data: {} },
    ) {
        super(message);
    }
}

function wpDetails(body: string): { code: string; data: Record<string, unknown> } {
    try {
        const j = JSON.parse(body) as { code?: unknown; data?: unknown };
        const data = j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? (j.data as Record<string, unknown>) : {};
        return { code: typeof j.code === 'string' ? j.code : '', data };
    } catch {
        return { code: '', data: {} };
    }
}

export interface WpPage {
    rows: WpJson[];
    total: number | null;
    totalPages: number | null;
}

/** 100 es el máximo por página que acepta la API REST de WordPress. */
export const WP_PAGE_SIZE = 100;
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
 * GET con reintentos para lo pasajero (5xx, 429, red): un sitio en un hosting
 * compartido falla de a ratos y un corte a mitad de una carga de miles de
 * entradas no tiene que tirar todo. Un 4xx de verdad (contraseña revocada) no
 * se reintenta: el motivo va directo a la pantalla.
 */
export async function wpGet(
    creds: IntegrationCreds,
    route: string,
    query: Array<[string, string]> = [],
): Promise<{ json: unknown; headers: Record<string, string> }> {
    const url = wpUrl(creds, route, query);
    const hide = [creds.secret].filter((s) => s.length >= 4);
    let lastError = '';
    let lastStatus = 0;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1));
        let res;
        try {
            res = await safeWebhookFetch(url, {
                method: 'GET',
                headers: wpHeaders(creds),
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
        lastStatus = res.status;
        const problem = classifyWpResponse(res.status, res.body ?? '', true, 'sync');
        if (problem?.kind === 'server') {
            lastError = problem.message;
            const retryAfter = headerInt(res.headers, 'retry-after');
            if (retryAfter !== null) await sleep(Math.min(retryAfter, 30) * 1000);
            continue;
        }
        if (problem) throw new WpApiError(problem.message, res.status, problem.kind, wpDetails(res.body ?? ''));
        if (res.truncated) throw new WpApiError('La respuesta del sitio es demasiado grande para leerla de una vez.', 413);
        try {
            return { json: JSON.parse(res.body ?? 'null') as unknown, headers: res.headers ?? {} };
        } catch {
            throw new WpApiError('El sitio respondió algo que no es la API (no es JSON).', res.status, 'blocked');
        }
    }
    throw new WpApiError(`No pudimos leer el sitio: ${lastError || 'sin respuesta'}.`, lastStatus, lastStatus ? 'server' : 'network');
}

/** Una página de una colección (`/wp/v2/posts`…). */
export async function wpGetPage(creds: IntegrationCreds, route: string, query: Array<[string, string]>): Promise<WpPage> {
    const { json, headers } = await wpGet(creds, route, query);
    if (!Array.isArray(json)) throw new WpApiError('El sitio no devolvió una lista donde se esperaba una.', 200);
    return {
        rows: json.filter((r): r is WpJson => r !== null && typeof r === 'object' && !Array.isArray(r)),
        total: headerInt(headers, 'x-wp-total'),
        totalPages: headerInt(headers, 'x-wp-totalpages'),
    };
}

/**
 * Escritura (lo editado en la app, un término nuevo). SIN reintentos a
 * ciegas: un POST de un término repetido crearía dos; el que llama decide.
 * `idempotent` = es una LECTURA por POST (la del complemento, v0.1.334): se
 * reintenta lo pasajero igual que un GET.
 *
 * Toda escritura lleva `X-Imagina-Source: app`: el complemento no avisa de
 * vuelta lo que cambió la propia app (no hay ecos en el tiempo real).
 */
export async function wpSend(
    creds: IntegrationCreds,
    method: 'POST' | 'DELETE',
    route: string,
    body: Record<string, unknown> | null,
    query: Array<[string, string]> = [],
    opts: { idempotent?: boolean; timeoutMs?: number } = {},
): Promise<unknown> {
    const url = wpUrl(creds, route, query);
    const hide = [creds.secret].filter((s) => s.length >= 4);
    const attempts = opts.idempotent ? RETRIES : 0;
    let lastError = '';
    let lastStatus = 0;
    for (let attempt = 0; attempt <= attempts; attempt++) {
        if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1));
        let res;
        try {
            res = await safeWebhookFetch(url, {
                method,
                headers: { ...wpHeaders(creds, body !== null), 'x-imagina-source': 'app' },
                body: body === null ? undefined : JSON.stringify(body),
                captureBody: true,
                maxCaptureBytes: MAX_PAGE_BYTES,
                timeoutMs: opts.timeoutMs ?? 30_000,
            });
        } catch (err) {
            lastError = redactValues(err instanceof Error ? err.message : String(err), hide);
            if (!opts.idempotent || /SSRF|no permitido|inválida/.test(lastError)) break;
            continue;
        }
        lastStatus = res.status;
        const problem = classifyWpResponse(res.status, res.body ?? '', true, 'sync');
        if (problem?.kind === 'server' && opts.idempotent && attempt < attempts) {
            lastError = problem.message;
            continue;
        }
        if (problem) throw new WpApiError(problem.message, res.status, problem.kind, wpDetails(res.body ?? ''));
        try {
            return JSON.parse(res.body ?? 'null') as unknown;
        } catch {
            return null;
        }
    }
    throw new WpApiError(`No pudimos hablar con el sitio: ${lastError || 'sin respuesta'}.`, lastStatus, lastStatus ? 'server' : 'network');
}
