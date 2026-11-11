import { isIP } from 'node:net';

/**
 * La clave con la que se cuenta a un visitante en los límites «por IP».
 *
 * En IPv4 es la dirección. En IPv6 es su red /64: a un cliente se le asigna
 * (como mínimo) un /64 entero — 2^64 direcciones —, así que contar por
 * dirección completa dejaba que UN visitante usara una dirección distinta en
 * cada pedido y ningún límite por IP lo alcanzara.
 *
 * - `::ffff:1.2.3.4` (IPv4 dentro de IPv6) cuenta como `1.2.3.4`.
 * - Lo que no es una IP se devuelve tal cual (recortado): nunca lanza.
 */
export function rateKeyForIp(ip: string | null | undefined): string {
    const raw = String(ip ?? '')
        .trim()
        .toLowerCase();
    if (raw === '') return 'unknown';
    // Sin corchetes ni zona (`fe80::1%eth0`).
    const bare = raw.replace(/^\[|\]$/g, '').split('%')[0]!;
    const kind = isIP(bare);
    if (kind === 4) return bare;
    if (kind !== 6) return raw.slice(0, 64);
    const hextets = expandIpv6(bare);
    if (!hextets) return bare;
    // IPv4 mapeada (::ffff:a.b.c.d) → la IPv4.
    if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
        return `${hextets[6]! >> 8}.${hextets[6]! & 0xff}.${hextets[7]! >> 8}.${hextets[7]! & 0xff}`;
    }
    return `${hextets
        .slice(0, 4)
        .map((h) => h.toString(16))
        .join(':')}::/64`;
}

/** Los 8 grupos de una IPv6 ya validada (o null si no se puede leer). */
function expandIpv6(addr: string): number[] | null {
    let text = addr;
    // Cola en notación IPv4 (`::ffff:1.2.3.4`).
    const lastColon = text.lastIndexOf(':');
    const tail = text.slice(lastColon + 1);
    if (tail.includes('.')) {
        const parts = tail.split('.').map(Number);
        if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
        text = `${text.slice(0, lastColon + 1)}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
    }
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
    const all = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...rest].map((h) => parseInt(h, 16));
    return all.length === 8 && all.every((h) => Number.isInteger(h) && h >= 0 && h <= 0xffff) ? all : null;
}
