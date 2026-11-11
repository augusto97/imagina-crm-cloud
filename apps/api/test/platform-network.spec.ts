import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cloudflareCacheRuleExpression, normalizeEmbedOrigin } from '@imagina-base/shared';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTrustProxy, cloudflareTrustedNow, setCloudflareTrusted } from '../src/common/trust-proxy';
import { loadEnv } from '../src/config/env';
import { tenants } from '../src/db/schema';
import { PublicNetCheckController } from '../src/network/network.controller';
import { NET_CHECK_PROBE_TOKEN, PLATFORM_NETWORK_KEY, PlatformNetworkService, type NetworkStore } from '../src/network/platform-network.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.409 (ADR-S102) — la «dirección rápida» de lo que se inserta en los
 * sitios web (Plataforma → Dominios): qué se acepta, a qué empresas aplica
 * (nunca a las que comparten por su dominio propio), el «Comprobar» contra
 * un Cloudflare simulado y la prueba pública que ve el servidor.
 */
class MemStore implements NetworkStore {
    readonly data = new Map<string, string>();
    async get(key: string): Promise<string | null> {
        return this.data.get(key) ?? null;
    }
    async set(key: string, value: string): Promise<unknown> {
        this.data.set(key, value);
        return 'OK';
    }
}

type Route = (req: IncomingMessage, res: ServerResponse) => void;

describe('v0.1.409 — dirección rápida para los sitios web', () => {
    let pg: TestPg;
    const env = loadEnv({ APP_BASE_URL: 'https://base.plataforma.test', PUBLIC_BASE_DOMAIN: 'apps.plataforma.test' });
    let svc: PlatformNetworkService;
    let store: MemStore;
    let server: Server;
    let origin = '';
    let route: Route = (_req, res) => res.end();
    const prevEgress = process.env.DEV_ALLOW_PRIVATE_EGRESS;

    beforeAll(async () => {
        pg = await startPostgres();
        await pg.db.insert(tenants).values([
            { slug: 'con-dominio', name: 'Con dominio', customDomain: 'crm.acme.test' },
            { slug: 'con-portal', name: 'Con portal', portalDomain: 'clientes.acme.test' },
        ]);
        // El «Cloudflare» de la prueba corre en esta máquina (en desarrollo
        // se permite pedirle a una dirección local).
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        server = createServer((req, res) => route(req, res));
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        process.env.DEV_ALLOW_PRIVATE_EGRESS = prevEgress;
        await new Promise<void>((r) => server?.close(() => r()));
        await pg?.stop();
    });

    afterEach(() => {
        setCloudflareTrusted(false);
    });

    function fresh(): PlatformNetworkService {
        store = new MemStore();
        svc = new PlatformNetworkService(store, env, pg.db);
        return svc;
    }

    it('acepta sólo una dirección al mismo nivel: ni la de la app, ni la de una empresa, ni rutas', async () => {
        fresh();
        expect(normalizeEmbedOrigin('w.acme.co')).toBe('https://w.acme.co');
        expect(normalizeEmbedOrigin('https://W.Acme.co/')).toBe('https://w.acme.co');
        expect(normalizeEmbedOrigin('http://w.acme.co')).toBeNull();
        expect(normalizeEmbedOrigin('http://localhost:8790', { allowHttp: true })).toBe('http://localhost:8790');
        const code = async (raw: string): Promise<string> => {
            try {
                await svc.validate(raw);
                return 'ok';
            } catch (err) {
                return ((err as { getResponse(): { code: string } }).getResponse()).code;
            }
        };
        expect(await code('w.acme.co/ruta')).toBe('embed_origin_invalid');
        expect(await code('https://user:pw@w.acme.co')).toBe('embed_origin_invalid');
        expect(await code('w.acme.co?x=1')).toBe('embed_origin_invalid');
        expect(await code('base.plataforma.test')).toBe('embed_origin_is_app');
        expect(await code('w.apps.plataforma.test')).toBe('embed_origin_under_base');
        expect(await code('crm.acme.test')).toBe('embed_origin_is_tenant_domain');
        expect(await code('clientes.acme.test')).toBe('embed_origin_is_tenant_domain');
        expect(await code('w.plataforma.test')).toBe('ok');
        expect(cloudflareCacheRuleExpression('https://w.plataforma.test')).toBe(
            '(http.host eq "w.plataforma.test" and starts_with(http.request.uri.path, "/api/v1/public/"))',
        );
    });

    it('guardar enciende la confianza en Cloudflare; los otros servidores se enteran al releer', async () => {
        fresh();
        const view = await svc.update({ embed_origin: 'w.plataforma.test', cloudflare: true });
        expect(view).toMatchObject({ embed_origin: 'https://w.plataforma.test', cloudflare: true, cloudflare_trusted: true, app_origin: 'https://base.plataforma.test' });
        expect(JSON.parse(store.data.get(PLATFORM_NETWORK_KEY)!)).toEqual({ embed_origin: 'https://w.plataforma.test', cloudflare: true });

        // Otro servidor (otra instancia) que lee la misma clave.
        setCloudflareTrusted(false);
        const other = new PlatformNetworkService(store, env, pg.db);
        await other.refresh();
        expect(other.embedOrigin()).toBe('https://w.plataforma.test');
        expect(cloudflareTrustedNow()).toBe(true);

        // Quitarla apaga todo; un valor roto vuelve al de fábrica sin romper.
        await svc.update({ embed_origin: null, cloudflare: false });
        expect(svc.embedOrigin()).toBeNull();
        expect(cloudflareTrustedNow()).toBe(false);
        store.data.set(PLATFORM_NETWORK_KEY, '{roto');
        await other.refresh();
        expect(other.get()).toEqual({ embed_origin: null, cloudflare: false });
        store.data.set(PLATFORM_NETWORK_KEY, JSON.stringify({ embed_origin: 'javascript:alert(1)', cloudflare: 'sí' }));
        await other.refresh();
        expect(other.get()).toEqual({ embed_origin: null, cloudflare: false });
    });

    it('los códigos usan la dirección rápida salvo que la empresa comparta por su dominio propio', async () => {
        fresh();
        expect(svc.embedOriginFor('https://base.plataforma.test')).toBeNull();
        await svc.update({ embed_origin: 'w.plataforma.test', cloudflare: true });
        expect(svc.embedOriginFor('https://base.plataforma.test')).toBe('https://w.plataforma.test');
        expect(svc.embedOriginFor('https://base.plataforma.test/')).toBe('https://w.plataforma.test');
        expect(svc.embedOriginFor(undefined)).toBe('https://w.plataforma.test');
        // White-label: con su dominio (o subdominio de la plataforma) no se le
        // pone una dirección de la plataforma en el código que pega.
        expect(svc.embedOriginFor('https://crm.acme.test')).toBeNull();
        expect(svc.embedOriginFor('https://acme.apps.plataforma.test')).toBeNull();
    });

    it('«Comprobar» dice qué falta, paso por paso, contra un Cloudflare simulado', async () => {
        fresh();
        const goodProbe = (extra: Record<string, unknown> = {}): string =>
            JSON.stringify({ ok: true, app: svc.fingerprint(), via_cloudflare: true, peer_is_cloudflare: true, ip_is_cloudflare: false, ...extra });
        const hits = new Map<string, number>();
        const cacheMode = { value: 'cache' as 'cache' | 'dynamic' };
        route = (req, res) => {
            const url = req.url ?? '';
            if (url === '/api/v1/public/net-check') {
                res.writeHead(200, { 'content-type': 'application/json', 'cf-ray': 'abc-BOG' });
                return res.end(goodProbe());
            }
            if (url === '/api/v1/public/f/embed.js' || url === `/api/v1/public/w/${NET_CHECK_PROBE_TOKEN}`) {
                const n = (hits.get(url) ?? 0) + 1;
                hits.set(url, n);
                const status = cacheMode.value === 'dynamic' ? 'DYNAMIC' : n === 1 ? 'MISS' : 'HIT';
                res.writeHead(url.endsWith('.js') ? 200 : 404, { 'cf-cache-status': status, 'cf-ray': 'abc-BOG' });
                return res.end('x');
            }
            res.writeHead(404);
            res.end();
        };

        // Las visitas llegan por Cloudflare y la caché funciona; todavía sin guardar.
        let r = await svc.check({ embed_origin: origin, cloudflare: true });
        expect(r.steps.map((s) => [s.id, s.ok])).toEqual([
            ['reach', true],
            ['same_app', true],
            ['via_cloudflare', true],
            ['real_ip', null],
            ['cache_script', true],
            ['cache_page', true],
        ]);
        expect(r.ok).toBe(true);
        // Nada se guardó por comprobar.
        expect(store.data.size).toBe(0);

        // Guardado: el servidor ya le cree a Cloudflare y ve la IP real.
        await svc.update({ embed_origin: origin, cloudflare: true });
        r = await svc.check({ embed_origin: origin, cloudflare: true });
        expect(r.steps.find((s) => s.id === 'real_ip')?.ok).toBe(true);

        // Falta la regla de caché: lo dice con lo que responde Cloudflare.
        cacheMode.value = 'dynamic';
        r = await svc.check({ embed_origin: origin, cloudflare: true });
        expect(r.ok).toBe(false);
        expect(r.steps.find((s) => s.id === 'cache_script')).toMatchObject({ ok: false, detail: expect.stringContaining('DYNAMIC') });
        cacheMode.value = 'cache';

        // Pasa por Cloudflare pero no se marcó: el servidor vería la IP de Cloudflare.
        r = await svc.check({ embed_origin: origin, cloudflare: false });
        expect(r.steps.find((s) => s.id === 'via_cloudflare')?.ok).toBe(false);
        expect(r.steps.find((s) => s.id === 'real_ip')?.ok).toBe(false);

        // Responde otra instalación.
        route = (_req, res) => {
            res.writeHead(200, { 'content-type': 'application/json', 'cf-ray': 'x' });
            res.end(JSON.stringify({ ok: true, app: 'otra-instalacion', via_cloudflare: true, peer_is_cloudflare: true, ip_is_cloudflare: false }));
        };
        r = await svc.check({ embed_origin: origin, cloudflare: true });
        expect(r.steps.map((s) => [s.id, s.ok])).toEqual([
            ['reach', true],
            ['same_app', false],
        ]);

        // Cloudflare no llega al servidor (521) o la dirección responde otra cosa.
        route = (_req, res) => {
            res.writeHead(521, { 'cf-ray': 'x' });
            res.end('Web server is down');
        };
        r = await svc.check({ embed_origin: origin, cloudflare: true });
        expect(r.steps).toEqual([{ id: 'reach', ok: false, detail: expect.stringContaining('521') }]);
        route = (_req, res) => {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html>otra página</html>');
        };
        r = await svc.check({ embed_origin: origin, cloudflare: true });
        expect(r.steps[0]).toMatchObject({ id: 'reach', ok: false });
    });

    it('la prueba pública: si pasó por Cloudflare y qué IP ve el servidor, sin devolver ninguna IP', async () => {
        fresh();
        const app = Fastify({ trustProxy: buildTrustProxy('loopback') });
        const ctrl = new PublicNetCheckController(svc);
        app.get('/net-check', (req, reply) => ctrl.netCheck(req, reply));
        const ask = async (headers: Record<string, string>, remoteAddress = '127.0.0.1'): Promise<Record<string, unknown>> => {
            const res = await app.inject({ method: 'GET', url: '/net-check', remoteAddress, headers });
            expect(res.headers['cache-control']).toBe('no-store');
            return res.json();
        };
        const viaCf = { 'x-forwarded-for': '203.0.113.9, 104.16.0.10', 'cf-ray': 'abc-BOG' };

        let probe = await ask(viaCf);
        expect(probe).toEqual({ ok: true, app: svc.fingerprint(), via_cloudflare: true, peer_is_cloudflare: true, ip_is_cloudflare: true });
        expect(JSON.stringify(probe)).not.toContain('203.0.113.9');

        setCloudflareTrusted(true);
        probe = await ask(viaCf);
        expect(probe.ip_is_cloudflare).toBe(false);

        // Sin Cloudflare de por medio.
        probe = await ask({ 'x-forwarded-for': '203.0.113.9' });
        expect(probe).toMatchObject({ via_cloudflare: false, peer_is_cloudflare: false, ip_is_cloudflare: false });
        await app.close();
    });
});
