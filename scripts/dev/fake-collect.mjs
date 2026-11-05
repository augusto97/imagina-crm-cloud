// Mercado Pago + Wompi simulados para el E2E de v0.1.251 (cobros de empresas)
// y v0.1.367 (suscripciones de Mercado Pago: preapproval + authorized_payments).
// v0.1.372 — PayPal (`/paypal/live` y `/paypal/sandbox`): token, órdenes,
// captura, capturas, webhooks y una página de aprobación que vuelve sola.
// v0.1.373 — Suscripciones de PayPal (Billing v1): productos, planes,
// suscripciones con su página de aprobación, acciones, precio, cobros y ventas.
// v0.1.376 — Búsqueda de suscripciones y de planes de Mercado Pago (importar):
// se siembran con `/__set` (`pre`, `mpPlans`, `invoices`, `payments`).
// v0.1.380 — `/__mp-invoices` hace fallar la búsqueda de cuotas (respuesta 400).
import http from 'node:http';
const state = { prefs: [], payments: {}, links: {}, txs: {}, pre: {}, mpPlans: {}, invoices: {}, calls: [], ppOrders: {}, ppCaptures: {}, ppWebhooks: [], ppDecline: false, ppProducts: {}, ppPlans: {}, ppSubs: {}, ppTx: {}, ppSales: {}, ppReq: {} };
let n = 0;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const ppNext = (sub) => {
    const c = sub.cycle.frequency;
    const d = new Date(sub.last_payment?.time ?? sub.start_time);
    if (c.interval_unit === 'DAY') d.setUTCDate(d.getUTCDate() + c.interval_count);
    else d.setUTCMonth(d.getUTCMonth() + c.interval_count);
    return d.toISOString();
};
const ppSubView = (sub) => ({
    id: sub.id,
    status: sub.status,
    plan_id: sub.plan_id,
    custom_id: sub.custom_id,
    start_time: sub.start_time,
    create_time: sub.create_time,
    subscriber: sub.subscriber,
    plan: { billing_cycles: [{ ...sub.cycle, pricing_scheme: { fixed_price: sub.price } }] },
    billing_info: {
        outstanding_balance: { value: '0.00', currency_code: sub.price.currency_code },
        failed_payments_count: sub.failed,
        ...(sub.last_payment ? { last_payment: sub.last_payment } : {}),
        ...(sub.last_failed ? { last_failed_payment: sub.last_failed } : {}),
        ...(sub.status === 'ACTIVE' ? { next_billing_time: sub.last_payment || new Date(sub.start_time).getTime() <= Date.now() ? ppNext(sub) : sub.start_time } : {}),
    },
    links: sub.status === 'APPROVAL_PENDING' ? [{ rel: 'approve', href: `http://127.0.0.1:4898/paypal-sub?ba=${sub.id}` }] : [],
});
/** Un cobro de la suscripción: bien (venta COMPLETED) o fallido (PayPal reintenta; al 3.º la suspende). */
const ppCharge = (sub, ok, reason) => {
    const time = new Date().toISOString();
    if (ok) {
        const id = `SALE${String(++n).padStart(8, '0')}`;
        state.ppTx[sub.id].push({ id, status: 'COMPLETED', time, amount_with_breakdown: { gross_amount: { ...sub.price } }, payer_email: sub.subscriber?.email_address });
        state.ppSales[id] = { id, state: 'completed', billing_agreement_id: sub.id, amount: { total: sub.price.value, currency: sub.price.currency_code } };
        sub.last_payment = { amount: { ...sub.price }, time };
        sub.failed = 0;
        sub.last_failed = null;
        return id;
    }
    sub.failed += 1;
    sub.last_failed = { amount: { ...sub.price }, time, reason_code: reason ?? 'PAYMENT_DENIED' };
    if (sub.failed >= 3) sub.status = 'SUSPENDED';
    return null;
};
http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
        let body = null;
        // El token de PayPal llega como formulario, no como JSON.
        try {
            body = raw ? JSON.parse(raw) : null;
        } catch {
            body = Object.fromEntries(new URLSearchParams(raw));
        }
        const u = new URL(req.url, 'http://x');
        const p = u.pathname;
        state.calls.push({ method: req.method, path: p + u.search, body, auth: req.headers.authorization });
        if (p === '/__state') return json(res, 200, state);
        if (p === '/__set' && req.method === 'POST') { Object.assign(state[body.kind], body.data); return json(res, 200, {}); }
        // Mezcla campos en un objeto ya guardado (p. ej. autorizar una suscripción).
        if (p === '/__patch' && req.method === 'POST') { state[body.kind][body.id] = { ...(state[body.kind][body.id] ?? {}), ...body.data }; return json(res, 200, state[body.kind][body.id]); }
        if (p.startsWith('/pay/') || p.startsWith('/wompi-pay/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<h1>Pago (simulado)</h1>'); }
        // ── PayPal (v0.1.372)
        let pm;
        if ((pm = p.match(/^\/paypal\/(live|sandbox)(\/.*)$/))) {
            const env = pm[1];
            const path = pm[2];
            if (path === '/v1/oauth2/token') {
                const raw = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
                const good = env === 'live' ? 'LIVE-e2e-client-id-0000000000000001:LIVE-e2e-secret-00000000000000000001' : 'SB-e2e-client-id-00000000000000000001:SB-e2e-secret-0000000000000000000001';
                return raw === good ? json(res, 200, { access_token: `pp-${env}`, expires_in: 32400 }) : json(res, 401, { error: 'invalid_client', error_description: 'Client Authentication failed' });
            }
            if (!/^Bearer pp-/.test(req.headers.authorization ?? '')) return json(res, 401, {});
            if (path === '/v2/checkout/orders' && req.method === 'POST') {
                const id = `ORD${String(++n).padStart(8, '0')}`;
                const ctx = body?.payment_source?.paypal?.experience_context ?? {};
                state.ppOrders[id] = { id, status: 'PAYER_ACTION_REQUIRED', purchase_units: body.purchase_units, return_url: ctx.return_url, cancel_url: ctx.cancel_url, brand: ctx.brand_name, links: [{ rel: 'payer-action', href: `http://127.0.0.1:4898/paypal-checkout?token=${id}` }] };
                return json(res, 200, state.ppOrders[id]);
            }
            let om;
            if ((om = path.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/)) && req.method === 'POST') {
                const o = state.ppOrders[om[1]];
                if (!o) return json(res, 404, { name: 'RESOURCE_NOT_FOUND' });
                if (o.status === 'COMPLETED') return json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
                if (o.status !== 'APPROVED') return json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
                if (state.ppDecline) { state.ppDecline = false; return json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] }); }
                const unit = o.purchase_units[0];
                const capId = `CAP${String(++n).padStart(8, '0')}`;
                const cap = { id: capId, status: 'COMPLETED', amount: unit.amount, create_time: new Date().toISOString(), supplementary_data: { related_ids: { order_id: o.id } } };
                state.ppCaptures[capId] = cap;
                o.status = 'COMPLETED';
                o.payment_source = { paypal: { email_address: 'cliente@correo.test' } };
                o.purchase_units = [{ ...unit, payments: { captures: [cap] } }];
                return json(res, 201, o);
            }
            if ((om = path.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)$/))) return state.ppOrders[om[1]] ? json(res, 200, state.ppOrders[om[1]]) : json(res, 404, { name: 'RESOURCE_NOT_FOUND' });
            if ((om = path.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/))) return state.ppCaptures[om[1]] ? json(res, 200, state.ppCaptures[om[1]]) : json(res, 404, {});
            // ── Suscripciones (v0.1.373)
            const rid = req.headers['paypal-request-id'];
            const idem = (kind, make) => {
                const k = rid ? `${kind}:${rid}` : null;
                if (k && state.ppReq[k]) return state.ppReq[k];
                const v = make();
                if (k) state.ppReq[k] = v;
                return v;
            };
            if (path === '/v1/catalogs/products' && req.method === 'POST') {
                const id = idem('product', () => { const id = `PROD-${String(++n).padStart(8, '0')}`; state.ppProducts[id] = { id, ...body }; return id; });
                return json(res, 201, state.ppProducts[id]);
            }
            if (path === '/v1/billing/plans' && req.method === 'POST') {
                if (!state.ppProducts[body?.product_id]) return json(res, 400, { name: 'INVALID_REQUEST', details: [{ issue: 'INVALID_PRODUCT' }] });
                const id = idem('plan', () => { const id = `P-${String(++n).padStart(10, '0')}`; state.ppPlans[id] = { id, status: 'ACTIVE', ...body }; return id; });
                return json(res, 201, state.ppPlans[id]);
            }
            if (path === '/v1/billing/subscriptions' && req.method === 'POST') {
                const plan = state.ppPlans[body?.plan_id];
                if (!plan) return json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'PLAN_NOT_FOUND' }] });
                const id = idem('sub', () => {
                    const id = `I-${String(++n).padStart(10, '0')}`;
                    const price = body?.plan?.billing_cycles?.[0]?.pricing_scheme?.fixed_price ?? plan.billing_cycles[0].pricing_scheme.fixed_price;
                    const ctx = body?.application_context ?? {};
                    state.ppSubs[id] = {
                        id, status: 'APPROVAL_PENDING', plan_id: plan.id, custom_id: body.custom_id, start_time: body.start_time ?? new Date().toISOString(),
                        subscriber: body.subscriber, price, cycle: plan.billing_cycles[0], return_url: ctx.return_url, cancel_url: ctx.cancel_url, brand: ctx.brand_name,
                        failed: 0, last_failed: null, last_payment: null, create_time: new Date().toISOString(),
                    };
                    state.ppTx[id] = [];
                    return id;
                });
                return json(res, 201, ppSubView(state.ppSubs[id]));
            }
            if ((om = path.match(/^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)\/transactions$/))) {
                if (!state.ppSubs[om[1]]) return json(res, 404, { name: 'RESOURCE_NOT_FOUND' });
                return json(res, 200, { transactions: state.ppTx[om[1]] ?? [] });
            }
            if ((om = path.match(/^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)\/(suspend|activate|cancel)$/)) && req.method === 'POST') {
                const sub = state.ppSubs[om[1]];
                if (!sub) return json(res, 404, { name: 'RESOURCE_NOT_FOUND' });
                const ok = { suspend: ['ACTIVE'], activate: ['SUSPENDED'], cancel: ['ACTIVE', 'SUSPENDED'] }[om[2]];
                if (!ok.includes(sub.status)) return json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'SUBSCRIPTION_STATUS_INVALID' }] });
                sub.status = { suspend: 'SUSPENDED', activate: 'ACTIVE', cancel: 'CANCELLED' }[om[2]];
                sub.reason = body?.reason;
                res.writeHead(204); return res.end();
            }
            if ((om = path.match(/^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)$/))) {
                const sub = state.ppSubs[om[1]];
                if (!sub) return json(res, 404, { name: 'RESOURCE_NOT_FOUND' });
                if (req.method === 'PATCH') {
                    const op = Array.isArray(body) ? body.find((o) => /fixed_price$/.test(o.path)) : null;
                    if (!op) return json(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_PATCH_OPERATION' }] });
                    sub.price = op.value;
                    res.writeHead(204); return res.end();
                }
                return json(res, 200, ppSubView(sub));
            }
            if ((om = path.match(/^\/v1\/payments\/sale\/([A-Z0-9-]+)$/))) return state.ppSales[om[1]] ? json(res, 200, state.ppSales[om[1]]) : json(res, 404, { name: 'RESOURCE_NOT_FOUND' });
            if (path === '/v1/notifications/webhooks' && req.method === 'GET') return json(res, 200, { webhooks: state.ppWebhooks });
            if (path === '/v1/notifications/webhooks' && req.method === 'POST') {
                if (state.ppWebhooks.some((w) => w.url === body.url)) return json(res, 400, { name: 'WEBHOOK_URL_ALREADY_EXISTS' });
                const hook = { id: `WH-${++n}`, url: body.url, event_types: body.event_types };
                state.ppWebhooks.push(hook);
                return json(res, 201, hook);
            }
            if ((om = path.match(/^\/v1\/notifications\/webhooks\/(.+)$/)) && req.method === 'DELETE') {
                state.ppWebhooks = state.ppWebhooks.filter((w) => w.id !== om[1]);
                res.writeHead(204); return res.end();
            }
            return json(res, 404, {});
        }
        // La página «de PayPal»: aprueba (o cancela) y vuelve a la app como PayPal.
        if (p === '/paypal-checkout') {
            const o = state.ppOrders[u.searchParams.get('token') ?? ''];
            if (!o) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>Orden no encontrada</h1>'); }
            const unit = o.purchase_units[0];
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(`<!doctype html><meta charset="utf-8"><title>PayPal (simulado)</title><h1>PayPal (simulado)</h1><p>${o.brand ?? ''} te cobra ${unit.amount.value} ${unit.amount.currency_code}: ${unit.description ?? ''}</p><a id="pp-approve" href="/paypal-approve?token=${o.id}">Pagar ahora</a> · <a id="pp-cancel" href="${o.cancel_url}?token=${o.id}">Cancelar y volver</a>`);
        }
        if (p === '/paypal-approve') {
            const o = state.ppOrders[u.searchParams.get('token') ?? ''];
            if (!o) return json(res, 404, {});
            if (o.status !== 'COMPLETED') o.status = 'APPROVED';
            o.payment_source = { paypal: { email_address: 'cliente@correo.test' } };
            res.writeHead(302, { location: `${o.return_url}?token=${o.id}&PayerID=PAYER123` });
            return res.end();
        }
        // La página «de PayPal» de una suscripción: aprueba (o cancela) y vuelve.
        if (p === '/paypal-sub') {
            const sub = state.ppSubs[u.searchParams.get('ba') ?? ''];
            if (!sub) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>Suscripción no encontrada</h1>'); }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(`<!doctype html><meta charset="utf-8"><title>PayPal (simulado)</title><h1>PayPal (simulado)</h1><p>${sub.brand ?? ''} · suscripción de ${sub.price.value} ${sub.price.currency_code}</p><a id="pp-sub-approve" href="/paypal-sub-approve?ba=${sub.id}">Aceptar y suscribirme</a> · <a id="pp-sub-cancel" href="${sub.cancel_url}">Cancelar y volver</a>`);
        }
        if (p === '/paypal-sub-approve') {
            const sub = state.ppSubs[u.searchParams.get('ba') ?? ''];
            if (!sub) return json(res, 404, {});
            if (sub.status === 'APPROVAL_PENDING') {
                sub.status = 'ACTIVE';
                // Sin prueba gratis, PayPal cobra la primera cuota al aprobar.
                if (new Date(sub.start_time).getTime() <= Date.now() + 60_000) ppCharge(sub, true);
            }
            const ret = new URL(sub.return_url);
            ret.searchParams.set('subscription_id', sub.id);
            ret.searchParams.set('ba_token', `BA-${sub.id}`);
            ret.searchParams.set('token', `EC-${sub.id}`);
            res.writeHead(302, { location: ret.toString() });
            return res.end();
        }
        // Controles: `{sub_charge: id, ok, reason}` agrega un cobro (o un fallo);
        // `{sub_status: id, status}` cambia el estado como si lo hiciera PayPal.
        if (p === '/__paypal-sub' && req.method === 'POST') {
            const sub = state.ppSubs[body?.sub_charge ?? body?.sub_status ?? ''];
            if (!sub) return json(res, 404, {});
            if (body.sub_charge) ppCharge(sub, body.ok !== false, body.reason);
            if (body.sub_status) sub.status = body.sub_status;
            if (body.refund) { const t = (state.ppTx[sub.id] ?? []).find((x) => x.id === body.refund); if (t) t.status = 'REFUNDED'; }
            return json(res, 200, ppSubView(sub));
        }
        if (p === '/__paypal' && req.method === 'POST') { if (body?.decline) state.ppDecline = true; if (body?.approve && state.ppOrders[body.approve]) state.ppOrders[body.approve].status = 'APPROVED'; return json(res, 200, {}); }
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
            if (ref !== null) return json(res, 200, { results: Object.values(state.payments).filter((x) => x.external_reference === ref).reverse() });
            // v0.1.382 — búsqueda amplia de la revisión de respaldo (`range=date_last_updated`).
            const offset = Number(u.searchParams.get('offset') ?? 0);
            const limit = Number(u.searchParams.get('limit') ?? 30);
            const all = Object.values(state.payments).sort((a, b) => String(b.date_last_updated ?? b.date_created ?? '').localeCompare(String(a.date_last_updated ?? a.date_created ?? '')));
            return json(res, 200, { paging: { offset, limit, total: all.length }, results: all.slice(offset, offset + limit) });
        }
        if (p === '/mp/preapproval' && req.method === 'POST') {
            const id = `pre-${++n}`;
            state.pre[id] = { id, ...body, status: 'pending', init_point: `http://127.0.0.1:4898/pay/${id}`, date_created: new Date().toISOString() };
            return json(res, 201, state.pre[id]);
        }
        if (p === '/mp/preapproval/search') {
            const offset = Number(u.searchParams.get('offset') ?? 0);
            const limit = Number(u.searchParams.get('limit') ?? 100);
            const all = Object.values(state.pre).sort((a, b) => String(b.date_created ?? '').localeCompare(String(a.date_created ?? '')));
            return json(res, 200, { paging: { offset, limit, total: all.length }, results: all.slice(offset, offset + limit) });
        }
        if (p === '/mp/preapproval_plan/search') {
            const all = Object.values(state.mpPlans);
            return json(res, 200, { paging: { offset: 0, limit: 100, total: all.length }, results: all });
        }
        // v0.1.380 — `POST /__mp-invoices {fail:true}`: la búsqueda de cuotas responde 400 (como en la cuenta real).
        if (p === '/__mp-invoices' && req.method === 'POST') { state.mpInvoicesFail = Boolean(body?.fail); return json(res, 200, {}); }
        if (p === '/mp/authorized_payments/search') {
            if (state.mpInvoicesFail) return json(res, 400, { message: 'invalid parameters', error: 'bad_request', status: 400 });
            const pre = u.searchParams.get('preapproval_id');
            return json(res, 200, { results: Object.values(state.invoices).filter((x) => x.preapproval_id === pre) });
        }
        let m;
        if ((m = p.match(/^\/mp\/preapproval\/(.+)$/))) {
            const cur = state.pre[m[1]];
            if (!cur) return json(res, 404, { message: 'not found' });
            if (req.method === 'PUT') {
                if (body?.status) cur.status = body.status;
                if (body?.auto_recurring) cur.auto_recurring = { ...cur.auto_recurring, ...body.auto_recurring };
            }
            return json(res, 200, cur);
        }
        if ((m = p.match(/^\/mp\/authorized_payments\/(.+)$/))) return state.invoices[m[1]] ? json(res, 200, state.invoices[m[1]]) : json(res, 404, {});
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
