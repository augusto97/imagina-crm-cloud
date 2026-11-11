import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTrustProxy, CLOUDFLARE_RANGES, isCloudflareIp, setCloudflareTrusted } from '../src/common/trust-proxy';

/**
 * v0.1.409 (ADR-S102) — con la «dirección rápida» detrás de Cloudflare, el
 * servidor ve llegar los pedidos desde los nodos de Cloudflare (a través del
 * nginx de la máquina). Si no les cree la cadena `X-Forwarded-For`, todos los
 * visitantes parecen la misma IP y los límites por visitante los frenan
 * juntos; si les cree a cualquiera, cualquiera elige su IP.
 */
const CF_NODE = '104.16.0.10';
const VISITOR = '203.0.113.9';

async function ipSeen(trust: ReturnType<typeof buildTrustProxy>, xff: string, remote = '127.0.0.1'): Promise<string> {
    const app = Fastify({ trustProxy: trust });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress: remote, headers: { 'x-forwarded-for': xff } });
    await app.close();
    return (res.json() as { ip: string }).ip;
}

describe('trustProxy con Cloudflare', () => {
    afterEach(() => {
        setCloudflareTrusted(false);
        buildTrustProxy('loopback');
    });

    it('reconoce las direcciones de Cloudflare (IPv4, IPv6 e IPv4 mapeada) y nada más', () => {
        expect(CLOUDFLARE_RANGES.length).toBeGreaterThan(15);
        expect(isCloudflareIp(CF_NODE)).toBe(true);
        expect(isCloudflareIp('::ffff:104.16.0.10')).toBe(true);
        expect(isCloudflareIp('2606:4700:10::6816:1')).toBe(true);
        expect(isCloudflareIp(VISITOR)).toBe(false);
        expect(isCloudflareIp('127.0.0.1')).toBe(false);
        expect(isCloudflareIp('no-es-ip')).toBe(false);
        expect(isCloudflareIp(null)).toBe(false);
    });

    it('sin la opción, el servidor ve el nodo de Cloudflare (todos los visitantes, la misma IP)', async () => {
        const trust = buildTrustProxy('loopback');
        expect(await ipSeen(trust, `${VISITOR}, ${CF_NODE}`)).toBe(CF_NODE);
    });

    it('con la opción encendida en Plataforma, ve la IP real del visitante', async () => {
        const trust = buildTrustProxy('loopback');
        setCloudflareTrusted(true);
        expect(await ipSeen(trust, `${VISITOR}, ${CF_NODE}`)).toBe(VISITOR);
        // La opción se lee en cada pedido: apagarla vuelve a cortar en el nodo.
        setCloudflareTrusted(false);
        expect(await ipSeen(trust, `${VISITOR}, ${CF_NODE}`)).toBe(CF_NODE);
    });

    it('nunca le cree a una dirección que no es de Cloudflare: inventarse la cadena no sirve', async () => {
        const trust = buildTrustProxy('loopback');
        setCloudflareTrusted(true);
        // Alguien que habla directo con el proxy local poniendo una IP propia
        // al final: no es de Cloudflare, así que es lo que el servidor ve.
        expect(await ipSeen(trust, `198.51.100.1, ${VISITOR}`)).toBe(VISITOR);
        // Y quien se conecta desde afuera (sin pasar por el proxy local) no
        // tiene cadena: se ve su dirección.
        expect(await ipSeen(trust, `198.51.100.1, ${CF_NODE}`, '198.51.100.77')).toBe('198.51.100.77');
    });

    it('`TRUST_PROXY=loopback,cloudflare` (o `cloudflare` solo) lo fija desde el .env', async () => {
        expect(await ipSeen(buildTrustProxy('loopback,cloudflare'), `${VISITOR}, ${CF_NODE}`)).toBe(VISITOR);
        expect(await ipSeen(buildTrustProxy('cloudflare'), `${VISITOR}, ${CF_NODE}`)).toBe(VISITOR);
    });

    it('`true` y `false` conservan su sentido de siempre', async () => {
        expect(buildTrustProxy(true)).toBe(true);
        expect(await ipSeen(buildTrustProxy(false), `${VISITOR}, ${CF_NODE}`)).toBe('127.0.0.1');
    });
});
