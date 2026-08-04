import { createHmac } from 'node:crypto';

/**
 * Construcción de la petición de `call_webhook` (v0.1.155).
 *
 * Antes el único camino era un `body_template` de texto: para pegarle a una
 * API real (por ejemplo un gateway de WhatsApp que pide
 * `application/x-www-form-urlencoded` con `secret`, `account`, `recipient`,
 * `message`) había que escribir el cuerpo a mano y adivinar el content-type.
 * Ahora el config admite filas clave/valor —cuerpo, cabeceras y parámetros de
 * la URL— y el tipo de contenido se elige.
 *
 * PURO a propósito: el probador de la UI y el motor arman EXACTAMENTE la misma
 * petición, así lo que se prueba es lo que después se ejecuta.
 */

export type MergeFn = (raw: unknown) => string;

export interface WebhookRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    /** `undefined` en GET/HEAD. */
    body?: string;
}

interface KeyValue {
    key: string;
    value: string;
}

/** Acepta filas `[{key,value}]` (UI nueva) o un objeto plano (config legacy). */
function readPairs(raw: unknown, merge: MergeFn): KeyValue[] {
    if (Array.isArray(raw)) {
        return raw
            .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
            .map((r) => ({ key: String(r.key ?? '').trim(), value: merge(r.value) }))
            .filter((r) => r.key !== '');
    }
    if (raw !== null && typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>)
            .map(([key, value]) => ({ key: key.trim(), value: merge(value) }))
            .filter((r) => r.key !== '');
    }
    return [];
}

export function buildWebhookRequest(
    cfg: Record<string, unknown>,
    merge: MergeFn,
    fallback: { recordId: number | null; listId: number },
): WebhookRequest {
    const method = String(cfg.method ?? 'POST').toUpperCase();
    const contentType = cfg.content_type === 'form' ? 'form' : 'json';

    // Query params: se agregan a la URL respetando lo que ya traiga escrito.
    let url = merge(cfg.url).trim();
    const query = readPairs(cfg.query_params, merge);
    if (query.length > 0) {
        const qs = query
            .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
            .join('&');
        url += (url.includes('?') ? '&' : '?') + qs;
    }

    const headers: Record<string, string> = {};
    for (const h of readPairs(cfg.headers, merge)) headers[h.key.toLowerCase()] = h.value;

    // Cuerpo: filas clave/valor si las hay; si no, la plantilla cruda; si no,
    // el payload por defecto con el registro que disparó.
    const params = readPairs(cfg.body_params, merge);
    const rawTemplate =
        typeof cfg.body_template === 'string' && cfg.body_template.trim() !== ''
            ? merge(cfg.body_template)
            : '';

    let body: string | undefined;
    if (method === 'GET' || method === 'HEAD') {
        body = undefined;
    } else if (params.length > 0) {
        if (contentType === 'form') {
            body = params
                .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
                .join('&');
            headers['content-type'] ??= 'application/x-www-form-urlencoded';
        } else {
            body = JSON.stringify(Object.fromEntries(params.map((p) => [p.key, p.value])));
            headers['content-type'] ??= 'application/json';
        }
    } else if (rawTemplate !== '') {
        body = rawTemplate;
        headers['content-type'] ??=
            contentType === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';
    } else {
        body = JSON.stringify({ record_id: fallback.recordId, list_id: fallback.listId });
        headers['content-type'] ??= 'application/json';
    }

    // Firma HMAC del cuerpo (opcional): el receptor puede verificar que el
    // pedido salió de acá y que nadie lo tocó en el camino.
    if (cfg.secret && body !== undefined) {
        headers['x-imagina-signature'] =
            'sha256=' + createHmac('sha256', String(cfg.secret)).update(body).digest('hex');
    }

    return { url, method, headers, body };
}
