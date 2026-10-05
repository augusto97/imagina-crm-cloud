// Mercado Pago + Wompi simulados para el E2E de v0.1.251 (cobros de empresas).
import http from 'node:http';
const state = { prefs: [], payments: {}, links: {}, txs: {}, calls: [] };
let n = 0;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        const u = new URL(req.url, 'http://x');
        const p = u.pathname;
        state.calls.push({ method: req.method, path: p + u.search, body, auth: req.headers.authorization });
        if (p === '/__state') return json(res, 200, state);
        if (p === '/__set' && req.method === 'POST') { Object.assign(state[body.kind], body.data); return json(res, 200, {}); }
        if (p.startsWith('/pay/') || p.startsWith('/wompi-pay/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>Pago (simulado)</h1>'); }
        // ── Mercado Pago
        if (p === '/mp/users/me') {
            return req.headers.authorization === 'Bearer APP_USR-e2e-buena'
                ? json(res, 200, { id: 1, nickname: 'TIENDA_E2E', site_id: 'MCO' })
                : json(res, 401, { message: 'invalid_token' });
        }
        if (p === '/mp/checkout/preferences' && req.method === 'POST') {
            const id = `pref-${++n}`; state.prefs.push({ id, ...body });
            return json(res, 201, { id, init_point: `http://127.0.0.1:4898/pay/${id}` });
        }
        if (p === '/mp/v1/payments/search') {
            const ref = u.searchParams.get('external_reference');
            return json(res, 200, { results: Object.values(state.payments).filter((x) => x.external_reference === ref).reverse() });
        }
        let m;
        if ((m = p.match(/^\/mp\/v1\/payments\/(.+)$/))) return state.payments[m[1]] ? json(res, 200, state.payments[m[1]]) : json(res, 404, {});
        // ── Wompi
        if ((m = p.match(/^\/wompi\/merchants\/(.+)$/))) {
            return m[1] === 'pub_test_e2e' ? json(res, 200, { data: { name: 'Acme Wompi' } }) : json(res, 404, { error: { type: 'NOT_FOUND_ERROR' } });
        }
        if (p === '/wompi/payment_links' && req.method === 'POST') {
            if (req.headers.authorization !== 'Bearer prv_test_e2e') return json(res, 401, { error: { type: 'INVALID_ACCESS_TOKEN', reason: 'Bad key' } });
            const id = `lnk_${++n}`; state.links[id] = { id, ...body, active: true };
            return json(res, 201, { data: state.links[id] });
        }
        if ((m = p.match(/^\/wompi\/payment_links\/(.+)$/)) && req.method === 'PATCH') {
            if (state.links[m[1]]) Object.assign(state.links[m[1]], body);
            return json(res, 200, { data: state.links[m[1]] ?? null });
        }
        if (p === '/wompi/transactions') return json(res, 200, { data: Object.values(state.txs) });
        if ((m = p.match(/^\/wompi\/transactions\/(.+)$/))) return state.txs[m[1]] ? json(res, 200, { data: state.txs[m[1]] }) : json(res, 404, {});
        json(res, 404, {});
    });
}).listen(4898, '127.0.0.1', () => console.log('fake collect :4898'));
