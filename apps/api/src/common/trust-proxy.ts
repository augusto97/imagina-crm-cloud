import proxyaddr from '@fastify/proxy-addr';

/**
 * v0.1.409 (ADR-S102) — Las direcciones desde las que Cloudflare se conecta a
 * los servidores (sus "proxies"). Lista oficial:
 * https://www.cloudflare.com/ips-v4 y https://www.cloudflare.com/ips-v6
 * (tomada el 2026-11-11; cambia muy de vez en cuando — si Cloudflare suma un
 * rango, se actualiza aquí en un release).
 */
export const CLOUDFLARE_RANGES: readonly string[] = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];

type TrustFn = (addr: string, hop: number) => boolean;

const cloudflareMatch: TrustFn = proxyaddr.compile([...CLOUDFLARE_RANGES]);

/** ¿Esa IP es de Cloudflare? (para el diagnóstico de Plataforma → Dominios). */
export function isCloudflareIp(ip: string | null | undefined): boolean {
    if (!ip) return false;
    try {
        return cloudflareMatch(ip.replace(/^::ffff:/i, ''), 0);
    } catch {
        return false;
    }
}

/**
 * Plataforma → Dominios dice que las visitas llegan por Cloudflare. Se lee en
 * CADA pedido (dentro de `trustProxy`): un booleano en memoria, que el
 * servicio de red refresca al guardar y cada minuto (otros servidores).
 */
let cloudflareTrusted = false;
export function setCloudflareTrusted(on: boolean): void {
    cloudflareTrusted = on;
}
export function cloudflareTrustedNow(): boolean {
    return cloudflareTrusted || envTrustsCloudflare;
}

let envTrustsCloudflare = false;

/**
 * El `trustProxy` de Fastify: a quién se le cree la cadena de
 * `X-Forwarded-*`. Lo de `TRUST_PROXY` (por defecto `loopback`: el nginx o el
 * Caddy de esta máquina) y, si la plataforma lo pide, también Cloudflare. Con
 * eso, detrás de Cloudflare `req.ip` es la IP del visitante y no la del nodo
 * de Cloudflare: los límites por visitante siguen siendo por visitante.
 *
 * `TRUST_PROXY` acepta además la palabra `cloudflare` en la lista
 * (`loopback,cloudflare`) para fijarlo desde el `.env`; sola, suma el proxy
 * local (`cloudflare` = `loopback,cloudflare`).
 *
 * Ojo, lo mismo que con cualquier proxy de confianza: alguien que hable
 * DIRECTO con este servidor desde una dirección de Cloudflare (un Worker)
 * puede elegir la IP que el servidor ve. Sólo afecta a los límites por IP (el
 * freno de contraseñas también cuenta por cuenta), por eso es opcional.
 */
export function buildTrustProxy(value: boolean | string): boolean | TrustFn {
    if (value === true) return true;
    let base: TrustFn = () => false;
    if (value !== false) {
        const parts = String(value)
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p !== '');
        envTrustsCloudflare = parts.some((p) => p.toLowerCase() === 'cloudflare');
        const rest = parts.filter((p) => p.toLowerCase() !== 'cloudflare');
        // `TRUST_PROXY=cloudflare` solo: el proxy de esta máquina sigue de confianza
        // (si no, el nginx que está entre Cloudflare y Node cortaría la cadena).
        if (rest.length === 0 && envTrustsCloudflare) rest.push('loopback');
        if (rest.length > 0) base = proxyaddr.compile(rest);
    }
    return (addr, hop) => base(addr, hop) || (cloudflareTrustedNow() && cloudflareMatch(addr, hop));
}
