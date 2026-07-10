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
}

export interface SafeFetchResult {
    status: number;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 256 * 1024;

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
    if (isIP(url.hostname) && isBlockedAddress(url.hostname)) {
        throw new BadRequestException(
            `SSRF: destino de red interna bloqueado (${url.hostname})`,
        );
    }

    const method = (opts.method ?? 'POST').toUpperCase();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise<SafeFetchResult>((resolve, reject) => {
        const req = transport(
            url,
            { method, headers: opts.headers, lookup: guardedLookup },
            (res) => {
                const status = res.statusCode ?? 0;
                let received = 0;
                res.on('data', (chunk: Buffer) => {
                    received += chunk.length;
                    if (received > MAX_RESPONSE_BYTES) res.destroy();
                });
                res.on('end', () => resolve({ status }));
                // Si abortamos por tamaño, el status ya se capturó.
                res.on('aborted', () => resolve({ status }));
                res.on('error', () => resolve({ status }));
            },
        );
        req.on('error', (err) => reject(err));
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Webhook excedió el timeout de ${timeoutMs}ms`));
        });
        if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
            req.write(opts.body);
        }
        req.end();
    });
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
            if (isBlockedAddress(a.address)) {
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
