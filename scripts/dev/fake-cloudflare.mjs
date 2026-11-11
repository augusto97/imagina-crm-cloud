// Doble de Cloudflare (nube naranja) delante de la app, para probar a mano y
// en el E2E la «dirección rápida» de Plataforma → Dominios (v0.1.409).
//
//   node scripts/dev/fake-cloudflare.mjs [puerto=8790] [destino=http://127.0.0.1:3001]
//
// En Plataforma → Dominios: «Dirección» = http://localhost:<puerto>.
// Hace lo que hace Cloudflare + el nginx del servidor:
//   - agrega `cf-ray` y `cf-connecting-ip`;
//   - `x-forwarded-for: <visitante>, <nodo de Cloudflare>` (lo que deja nginx
//     al pasar el pedido a Node: la IP real del visitante y, al final, la del
//     nodo de Cloudflare que se le conectó);
//   - guarda en caché los GET bajo /api/v1/public/ que la app marca como
//     públicos (respeta s-maxage / max-age) y responde `cf-cache-status`
//     MISS → HIT; lo demás sale como DYNAMIC (sin caché).
// El visitante se puede elegir con la cabecera `x-test-visitor`.
//
// Para las pruebas:
//   GET  /__fakecf/state            → { hits, misses, dynamic, cached }
//   POST /__fakecf/mode {cache: bool, node_ip?: string}
//        cache:false simula que falta la regla de caché (todo DYNAMIC);
//        node_ip: la IP del nodo de Cloudflare que se conecta (por defecto 104.16.0.10)
//   POST /__fakecf/reset            → vacía la caché y los contadores
import http from 'node:http';

const port = Number(process.argv[2] ?? 8790);
const target = new URL(process.argv[3] ?? 'http://127.0.0.1:3001');

const cache = new Map();
const stats = { hits: 0, misses: 0, dynamic: 0 };
let cacheOn = true;
let nodeIp = '104.16.0.10';

function ttlOf(headers) {
    const cc = String(headers['cache-control'] ?? '').toLowerCase();
    if (cc === '' || /no-store|private|no-cache/.test(cc) || !/public/.test(cc)) return 0;
    const s = /s-maxage=(\d+)/.exec(cc) ?? /max-age=(\d+)/.exec(cc);
    return s ? Number(s[1]) : 0;
}

function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/__fakecf/')) {
        if (req.url === '/__fakecf/state') return json(res, 200, { ...stats, cached: cache.size, cache: cacheOn, node_ip: nodeIp });
        if (req.url === '/__fakecf/reset') {
            cache.clear();
            stats.hits = stats.misses = stats.dynamic = 0;
            return json(res, 200, { ok: true });
        }
        if (req.url === '/__fakecf/mode') {
            let raw = '';
            req.on('data', (c) => (raw += c));
            req.on('end', () => {
                const body = raw ? JSON.parse(raw) : {};
                if (typeof body.cache === 'boolean') cacheOn = body.cache;
                if (typeof body.node_ip === 'string') nodeIp = body.node_ip;
                cache.clear();
                json(res, 200, { ok: true, cache: cacheOn, node_ip: nodeIp });
            });
            return;
        }
        return json(res, 404, { error: 'unknown' });
    }

    const visitor = String(req.headers['x-test-visitor'] ?? '203.0.113.9');
    const ray = `${Math.random().toString(16).slice(2, 18)}-BOG`;
    const cacheable = cacheOn && req.method === 'GET' && (req.url ?? '').startsWith('/api/v1/public/');
    const key = `${req.headers['accept-encoding'] ?? ''}|${req.url}`;

    if (cacheable) {
        const hit = cache.get(key);
        if (hit && hit.until > Date.now()) {
            stats.hits++;
            res.writeHead(hit.status, { ...hit.headers, 'cf-cache-status': 'HIT', 'cf-ray': ray, age: String(Math.floor((Date.now() - hit.at) / 1000)) });
            return res.end(hit.body);
        }
    }

    const headers = { ...req.headers };
    delete headers['x-test-visitor'];
    headers.host = target.host;
    headers['x-forwarded-host'] = req.headers.host ?? '';
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-for'] = `${visitor}, ${nodeIp}`;
    headers['cf-ray'] = ray;
    headers['cf-connecting-ip'] = visitor;
    headers['cf-ipcountry'] = 'CO';

    const up = http.request(
        { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers },
        (upRes) => {
            const chunks = [];
            upRes.on('data', (c) => chunks.push(c));
            upRes.on('end', () => {
                const body = Buffer.concat(chunks);
                const out = { ...upRes.headers };
                const ttl = cacheable ? ttlOf(upRes.headers) : 0;
                let status = 'DYNAMIC';
                if (cacheable && ttl > 0 && (upRes.statusCode === 200 || upRes.statusCode === 404)) {
                    status = 'MISS';
                    stats.misses++;
                    cache.set(key, { status: upRes.statusCode, headers: out, body, at: Date.now(), until: Date.now() + ttl * 1000 });
                } else {
                    stats.dynamic++;
                }
                res.writeHead(upRes.statusCode ?? 502, { ...out, 'cf-cache-status': status, 'cf-ray': ray, server: 'cloudflare' });
                res.end(body);
            });
        },
    );
    up.on('error', () => {
        res.writeHead(521, { 'content-type': 'text/plain', 'cf-ray': ray });
        res.end('Web server is down');
    });
    req.pipe(up);
});

server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Cloudflare de prueba en http://localhost:${port} → ${target.origin}`);
});
