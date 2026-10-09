import { Injectable, NotFoundException } from '@nestjs/common';
import { safeWebhookFetch, type SafeFetchResult } from '../common/safe-fetch';

/**
 * v0.1.210 — Miniaturas de imágenes EXTERNAS (la foto de un producto de la
 * tienda) servidas por el propio API.
 *
 * Por qué un proxy y no un `<img src>` directo: la CSP del SPA es
 * `img-src 'self' data: blob:` (v0.1.113), así que en producción el navegador
 * BLOQUEA cualquier imagen de otro dominio. Abrirla (`img-src https:`) exige
 * tocar el proxy del servidor a mano —la auto-actualización no lo toca—, y
 * además dejaría que cualquier texto de un registro dispare pedidos del
 * navegador a terceros. Aquí la imagen sale por `'self'`:
 *
 *  - sólo con sesión (no es un proxy abierto);
 *  - por `safeWebhookFetch` (guard anti-SSRF de SEC-03, sin DNS-rebinding),
 *    siguiendo a mano hasta 3 redirecciones, cada una re-validada;
 *  - sólo tipos de imagen que el navegador muestra sin ejecutar nada (la
 *    misma whitelist que la descarga de archivos; SVG queda FUERA: ejecuta
 *    script) y hasta 5 MB;
 *  - cualquier cosa rara → 404 opaco (la UI muestra el enlace de texto).
 */

export const IMAGE_PROXY_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2048;

const IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
    'image/x-icon',
]);

/** La URL pedida, validada: http(s), sin credenciales embebidas, de largo razonable. */
export function imageProxyTarget(raw: unknown): URL | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    // http también: la imagen la pide el SERVIDOR (con el guard anti-SSRF) y
    // al navegador le llega por el origen propio, así que no hay contenido mixto.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url;
}

/** Content-type servible como imagen (sin parámetros), o null. */
export function imageContentType(raw: string | undefined): string | null {
    const base = (raw ?? '').split(';')[0]!.trim().toLowerCase();
    return IMAGE_TYPES.has(base) ? base : null;
}

export interface ProxiedImage {
    contentType: string;
    bytes: Buffer;
}

type Fetcher = (url: string) => Promise<SafeFetchResult>;

@Injectable()
export class ImageProxyService {
    /** Inyectable para los tests: la red se simula en el borde, como en las tiendas. */
    fetcher: Fetcher = (url) =>
        safeWebhookFetch(url, {
            method: 'GET',
            headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
            captureBody: true,
            binary: true,
            maxCaptureBytes: IMAGE_PROXY_MAX_BYTES,
            timeoutMs: 8000,
        });

    async fetch(raw: unknown): Promise<ProxiedImage> {
        const first = imageProxyTarget(raw);
        if (!first) throw new NotFoundException();
        let target: URL = first;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            let res: SafeFetchResult;
            try {
                res = await this.fetcher(target.toString());
            } catch {
                // Destino bloqueado por el guard, DNS, timeout… siempre opaco.
                throw new NotFoundException();
            }
            if (res.status >= 300 && res.status < 400) {
                const next = res.headers?.location;
                const resolved: URL | null = next ? imageProxyTarget(safeResolve(next, target)) : null;
                if (!resolved) throw new NotFoundException();
                target = resolved;
                continue;
            }
            const contentType = imageContentType(res.contentType);
            if (res.status !== 200 || !contentType || res.truncated || !res.bytes || res.bytes.length === 0) {
                throw new NotFoundException();
            }
            return { contentType, bytes: res.bytes };
        }
        throw new NotFoundException();
    }
}

function safeResolve(location: string, base: URL): string {
    try {
        return new URL(location, base).toString();
    } catch {
        return '';
    }
}
