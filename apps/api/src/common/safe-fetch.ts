import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';

/**
 * Fetch con guard de egreso anti-SSRF (SEC-03).
 *
 * La acción `call_webhook` de las automatizaciones deja que un tenant
 * configure la URL a la que el SERVIDOR hace una petición cuando cambia un
 * registro. Sin protección, un tenant puede apuntar a la metadata del cloud
 * (169.254.169.254), a loopback, o a los hosts internos de Postgres/Redis, y
 * usar el servidor como escáner/proxy de la red interna.
 *
 * Defensas:
 *  - Solo esquemas http/https.
 *  - `lookup` custom: resuelve el hostname, valida TODAS las IPs y bloquea
 *    rangos privados/loopback/link-local/ULA/multicast. El socket se conecta
 *    exactamente a la IP que devuelve el lookup → no hay segunda resolución,
 *    lo que cierra el DNS-rebinding.
 *  - Sin seguir redirects (node http no los sigue por defecto).
 *  - Timeout duro y tope de bytes de respuesta.
 */

export interface SafeFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    /**
     * Devolver el cuerpo de la respuesta (capado). Lo usa el PROBADOR de
     * webhooks (v0.1.155): sin ver qué contestó el otro lado, "200" no alcanza
     * para saber si el mensaje salió. El motor no lo pide: no le sirve y
     * evita retener respuestas grandes en memoria.
     */
    captureBody?: boolean;
    /**
     * Con `captureBody`: cuánto del cuerpo se retiene (default 8 KB, el del
     * probador). La sincronización con tiendas (v0.1.206) lee páginas de 100
     * pedidos, que pesan cientos de KB: sube el tope explícitamente y el
     * cuerpo llega COMPLETO (sin el recorte de caracteres del probador).
     */
    maxCaptureBytes?: number;
    /**
     * Con `captureBody`: devolver el cuerpo como BYTES (`bytes`) en vez de
     * texto. Lo usa el proxy de miniaturas (v0.1.210): una imagen decodificada
     * como UTF-8 se corrompe.
     */
    binary?: boolean;
}

export interface SafeFetchResult {
    status: number;
    /** Sólo con `captureBody`: primeros 8 KB de la respuesta (o `maxCaptureBytes`). */
    body?: string;
    contentType?: string;
    /** Con `captureBody`: las cabeceras de la respuesta, en minúscula. */
    headers?: Record<string, string>;
    /** El cuerpo superó el tope y llegó cortado. */
    truncated?: boolean;
    /** Sólo con `captureBody` + `binary`: el cuerpo tal cual llegó. */
    bytes?: Buffer;
}

/**
 * v0.1.205 — SÓLO para desarrollo: deja salir a direcciones privadas y a
 * `http://` para probar de punta a punta contra un servidor local (una tienda
 * WooCommerce falsa en el propio contenedor). En producción se IGNORA aunque
 * la variable esté puesta: el guard anti-SSRF no tiene interruptor ahí.
 */
export function devPrivateEgressAllowed(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.DEV_ALLOW_PRIVATE_EGRESS === '1';
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 256 * 1024;
/** Tope de lo que se retiene y se muestra en el probador. */
const MAX_PREVIEW_BYTES = 8 * 1024;
const MAX_PREVIEW_CHARS = 4000;
/** Techo absoluto de lo que se puede pedir retener (una página de la API de una tienda). */
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export async function safeWebhookFetch(
    rawUrl: string,
    opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new BadRequestException('URL de webhook inválida');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BadRequestException(`Esquema de webhook no permitido: ${url.protocol}`);
    }

    // Node NO llama a `lookup` cuando el hostname ya es una IP literal, así que
    // el guard del lookup se saltaría con `http://169.254.169.254/`. Validamos
    // la IP literal acá. (`URL.hostname` devuelve IPv6 sin corchetes.)
    if (isIP(url.hostname) && isBlockedAddress(url.hostname) && !devPrivateEgressAllowed()) {
        throw new BadRequestException(
            `SSRF: destino de red interna bloqueado (${url.hostname})`,
        );
    }

    const method = (opts.method ?? 'POST').toUpperCase();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers = withContentLength(opts.headers ?? {}, method, opts.body);
    const hasBody = opts.body !== undefined && method !== 'GET' && method !== 'HEAD';
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise<SafeFetchResult>((resolve, reject) => {
        const req = transport(
            url,
            { method, headers, lookup: guardedLookup },
            (res) => {
                const status = res.statusCode ?? 0;
                const contentType = String(res.headers['content-type'] ?? '');
                const big = opts.maxCaptureBytes !== undefined;
                const keep = big ? Math.min(opts.maxCaptureBytes!, MAX_CAPTURE_BYTES) : MAX_PREVIEW_BYTES;
                const hardCap = big ? keep : MAX_RESPONSE_BYTES;
                let received = 0;
                let truncated = false;
                const chunks: Buffer[] = [];
                const done = (): SafeFetchResult => {
                    if (!opts.captureBody) return { status };
                    const headers: Record<string, string> = {};
                    for (const [k, v] of Object.entries(res.headers)) {
                        if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
                    }
                    if (opts.binary) return { status, contentType, headers, truncated, bytes: Buffer.concat(chunks) };
                    const text = Buffer.concat(chunks).toString('utf8');
                    return {
                        status,
                        contentType,
                        headers,
                        truncated,
                        body: big ? text : text.slice(0, MAX_PREVIEW_CHARS),
                    };
                };
                res.on('data', (chunk: Buffer) => {
                    received += chunk.length;
                    if (opts.captureBody && received <= keep) chunks.push(chunk);
                    else if (opts.captureBody) truncated = true;
                    if (received > hardCap) {
                        truncated = true;
                        res.destroy();
                    }
                });
                res.on('end', () => resolve(done()));
                // Si abortamos por tamaño, el status ya se capturó.
                res.on('aborted', () => resolve(done()));
                res.on('error', () => resolve(done()));
            },
        );
        req.on('error', (err) => reject(err));
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Webhook excedió el timeout de ${timeoutMs}ms`));
        });
        if (hasBody) {
            req.write(opts.body);
        }
        req.end();
    });
}

/**
 * v0.1.157 — `Content-Length` OBLIGATORIO cuando hay cuerpo.
 *
 * Sin esa cabecera, node:http manda `Transfer-Encoding: chunked` y Apache/PHP
 * (y varios gateways de WhatsApp/SMS) contestan **411 Length Required** sin
 * leer el cuerpo. Se respeta un content-length puesto por el llamador.
 */
export function withContentLength(
    headers: Record<string, string>,
    method: string,
    body: string | undefined,
): Record<string, string> {
    const out = { ...headers };
    const verb = method.toUpperCase();
    if (body === undefined || verb === 'GET' || verb === 'HEAD') return out;
    if (Object.keys(out).some((h) => h.toLowerCase() === 'content-length')) return out;
    out['content-length'] = String(Buffer.byteLength(body));
    return out;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number) => void;

/**
 * `lookup` compatible con node:net. Resuelve todas las direcciones, bloquea
 * si alguna es privada, y devuelve al llamador en la forma que pidió
 * (`options.all` array o dirección única).
 */
function guardedLookup(hostname: string, options: unknown, callback: LookupCb): void {
    const opts =
        typeof options === 'number'
            ? { family: options }
            : ((options as Record<string, unknown> | undefined) ?? {});
    dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) {
            callback(err, '', 0);
            return;
        }
        const list = addresses as LookupAddress[];
        for (const a of list) {
            if (isBlockedAddress(a.address) && !devPrivateEgressAllowed()) {
                callback(
                    new Error(`SSRF: dirección de red interna bloqueada (${a.address})`),
                    '',
                    0,
                );
                return;
            }
        }
        if (opts.all) {
            callback(null, list, 0);
            return;
        }
        const first = list[0]!;
        callback(null, first.address, first.family);
    });
}

/** Bloquea IPs no enrutables públicamente (loopback, privadas, link-local…). */
export function isBlockedAddress(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) return isBlockedV4(ip);
    if (version === 6) return isBlockedV6(ip);
    return true; // desconocido → bloquear por seguridad
}

function isBlockedV4(ip: string): boolean {
    const parts = ip.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return true;
    }
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 privada
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 privada
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 privada
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
    if (a >= 224) return true; // multicast (224/4) y reservado (240/4)
    return false;
}

function isBlockedV6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isBlockedV4(mapped[1]!); // IPv4-mapped
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
    const p3 = lower.slice(0, 3);
    if (p3 === 'fe8' || p3 === 'fe9' || p3 === 'fea' || p3 === 'feb') return true; // fe80::/10 link-local
    if (lower.startsWith('ff')) return true; // ff00::/8 multicast
    return false;
}
