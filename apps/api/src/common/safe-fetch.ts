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
    // la IP literal acá.
    //
    // SEC-23 (v0.1.225): `URL.hostname` devuelve el IPv6 CON corchetes
    // (`[::1]`), así que `isIP` daba 0 y un literal IPv6 no pasaba por NINGÚN
    // control — `http://[::ffff:a9fe:a9fe]/` llegaba a la metadata del cloud y
    // `http://[::ffff:7f00:1]:2019/` al admin de Caddy. Se quitan los
    // corchetes antes de validar.
    const literal = bareHost(url.hostname);
    if (isIP(literal) && isBlockedAddress(literal) && !devPrivateEgressAllowed()) {
        throw new BadRequestException(`SSRF: destino de red interna bloqueado (${literal})`);
    }

    const method = (opts.method ?? 'POST').toUpperCase();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers = withContentLength(stripUnsafeHeaders(opts.headers ?? {}), method, opts.body);
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
        // `setTimeout` del request es de INACTIVIDAD: un servidor que gotea un
        // byte cada pocos segundos lo renueva para siempre y retiene al worker.
        // SEC-23: además hay un tope TOTAL.
        const totalMs = Math.max(timeoutMs * 3, 30_000);
        const deadline = setTimeout(() => {
            req.destroy(new Error(`Webhook excedió el tiempo total de ${totalMs}ms`));
        }, totalMs);
        deadline.unref();
        req.on('close', () => clearTimeout(deadline));
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

/**
 * SEC-27 (v0.1.226) — resuelve un host para una conexión NO-HTTP (SMTP) con
 * el mismo criterio del guard: TODAS sus direcciones tienen que ser públicas.
 * Devuelve la primera para FIJAR la conexión a esa IP (si se vuelve a
 * resolver al conectar, un DNS que cambia entre medio —rebinding— salta el
 * control).
 */
export async function resolvePublicHost(
    host: string,
    opts: { allowPrivate?: boolean } = {},
): Promise<{ ok: true; address: string; addresses: string[] } | { ok: false; reason: 'dns' | 'blocked'; error: string; addresses: string[] }> {
    const bare = bareHost(host.trim());
    let addresses: string[];
    if (isIP(bare)) {
        addresses = [bare];
    } else {
        try {
            const list = await new Promise<LookupAddress[]>((resolve, reject) =>
                dnsLookup(bare, { all: true }, (err, res) => (err ? reject(err) : resolve(res))),
            );
            addresses = list.map((a) => a.address);
        } catch (err) {
            return { ok: false, reason: 'dns', error: (err as NodeJS.ErrnoException).code ?? String(err), addresses: [] };
        }
    }
    if (addresses.length === 0) return { ok: false, reason: 'dns', error: 'sin direcciones', addresses };
    const allow = opts.allowPrivate === true || devPrivateEgressAllowed();
    if (!allow && addresses.some(isBlockedAddress)) {
        return { ok: false, reason: 'blocked', error: 'dirección de red interna', addresses };
    }
    return { ok: true, address: addresses[0]!, addresses };
}

/** `[::1]` → `::1` (el hostname de un URL trae el IPv6 entre corchetes). */
export function bareHost(hostname: string): string {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Cabeceras que el LLAMADOR no puede fijar (SEC-23). `host` redirige la
 * petición a otro virtual host del destino (con loopback alcanzable era la
 * llave del admin de Caddy); las de framing (`content-length`,
 * `transfer-encoding`, `connection`…) las arma node y dejarlas pasar abre
 * request smuggling contra el destino.
 */
const UNSAFE_HEADERS = new Set([
    'host',
    'content-length',
    'transfer-encoding',
    'connection',
    'keep-alive',
    'upgrade',
    'te',
    'trailer',
    'proxy-authorization',
    'proxy-connection',
]);

export function stripUnsafeHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        if (!UNSAFE_HEADERS.has(k.trim().toLowerCase())) out[k] = v;
    }
    return out;
}

/**
 * Bloquea IPs no enrutables públicamente (loopback, privadas, link-local,
 * metadata cloud, rangos de documentación/benchmark, y cualquier IPv6 que
 * EMBEBA una IPv4 bloqueada). Acepta el IPv6 con o sin corchetes.
 */
export function isBlockedAddress(ip: string): boolean {
    const bare = bareHost(ip.trim());
    const version = isIP(bare);
    if (version === 4) return isBlockedV4(bare);
    if (version === 6) return isBlockedV6(bare);
    return true; // desconocido → bloquear por seguridad
}

function v4Octets(ip: string): [number, number, number, number] | null {
    const parts = ip.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return parts as [number, number, number, number];
}

function isBlockedV4(ip: string): boolean {
    const o = v4Octets(ip);
    return o === null ? true : isBlockedV4Octets(o);
}

function isBlockedV4Octets([a, b, c]: [number, number, number, number]): boolean {
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 privada
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 privada
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 privada
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT (y 100.100.100.200, metadata Alibaba)
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
    if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 relay 6to4
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 documentación
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 documentación
    if (a >= 224) return true; // multicast (224/4), reservado (240/4) y broadcast
    return false;
}

/**
 * IPv6 → 8 hextetos (acepta `::` y la cola IPv4 punteada). `null` si no
 * parsea. Se trabaja sobre NÚMEROS, no sobre el texto: `::ffff:7f00:1`,
 * `::ffff:127.0.0.1` y `0:0:0:0:0:ffff:7f00:0001` son la misma dirección y un
 * match por regex sobre el texto dejaba pasar las dos últimas.
 */
export function ipv6Hextets(ip: string): number[] | null {
    let s = bareHost(ip.trim().toLowerCase());
    const zone = s.indexOf('%');
    if (zone >= 0) s = s.slice(0, zone);
    // Cola IPv4 punteada (`::ffff:1.2.3.4`): son los DOS últimos hextetos.
    let v4: number[] = [];
    const lastColon = s.lastIndexOf(':');
    if (lastColon < 0) return null;
    const last = s.slice(lastColon + 1);
    if (last.includes('.')) {
        const o = v4Octets(last);
        if (!o) return null;
        v4 = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
        s = s.slice(0, lastColon + 1);
        if (!s.endsWith('::')) s = s.slice(0, -1);
    }
    const want = 8 - v4.length;
    const parse = (part: string): number[] =>
        part === '' ? [] : part.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
    const halves = s.split('::');
    if (halves.length > 2) return null;
    let groups: number[];
    if (halves.length === 2) {
        const head = parse(halves[0]!);
        const rest = parse(halves[1]!);
        const fill = want - head.length - rest.length;
        if (fill < 0) return null;
        groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
    } else {
        groups = parse(s);
    }
    const out = [...groups, ...v4];
    if (out.length !== 8 || out.some((h) => Number.isNaN(h))) return null;
    return out;
}

function embeddedV4(h1: number, h2: number): [number, number, number, number] {
    return [h1 >> 8, h1 & 0xff, h2 >> 8, h2 & 0xff];
}

function isBlockedV6(ip: string): boolean {
    const h = ipv6Hextets(ip);
    if (!h) return true;
    const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [number, number, number, number, number, number, number, number];
    // ::/96 — unspecified, loopback e IPv4-compatible (deprecado): todo afuera.
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return true;
    // ::ffff:0:0/96 IPv4-mapped — decide la IPv4 embebida.
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
        return isBlockedV4Octets(embeddedV4(h6, h7));
    }
    // 64:ff9b::/96 NAT64 — decide la IPv4 embebida; 64:ff9b:1::/48 es de uso local.
    if (h0 === 0x64 && h1 === 0xff9b) {
        if (h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return isBlockedV4Octets(embeddedV4(h6, h7));
        return true;
    }
    // 100::/64 discard.
    if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true;
    // 2002::/16 6to4 — la IPv4 va en los hextetos 1-2.
    if (h0 === 0x2002) return isBlockedV4Octets(embeddedV4(h1, h2));
    // 2001::/32 Teredo (IPv4 ofuscada), 2001:db8::/32 documentación, 2001:10::/28 ORCHID.
    if (h0 === 0x2001 && (h1 === 0 || h1 === 0xdb8 || (h1 & 0xfff0) === 0x10)) return true;
    // Sólo unicast global (2000::/3). Eso deja afuera ULA fc00::/7, link-local
    // fe80::/10, site-local fec0::/10, multicast ff00::/8 y todo lo reservado.
    if ((h0 & 0xe000) !== 0x2000) return true;
    return false;
}
