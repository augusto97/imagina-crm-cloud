// Tienda WooCommerce FALSA para E2E (API REST wc/v3 con la forma real).
// Uso: node fake-woo.mjs [puerto]   (default 9911)
// Env: FAKE_WOO_STRIP_AUTH=1 simula un hosting que tira la cabecera Authorization.
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';

const PORT = Number(process.argv[2] ?? 9911);
const CK = 'ck_demo_1234567890';
const CS = 'cs_demo_abcdefghij';
const STRIP_AUTH = process.env.FAKE_WOO_STRIP_AUTH === '1';

let seq = 1000;
const nextId = () => ++seq;
const iso = (d) => d.toISOString().slice(0, 19);
let clock = Date.parse('2026-06-01T12:00:00Z');
const tick = (ms = 60_000) => new Date((clock += ms));

function reset() {
    seq = 1000;
    clock = Date.parse('2026-06-01T12:00:00Z');
    state.customers = [];
    state.products = [];
    state.variations = {};
    state.orders = [];
    state.notes = [];
    state.coupons = [];
    state.webhooks = [];
    state.deliveries = [];
    const address = (first, last, email, city) => ({
        first_name: first, last_name: last, company: '', address_1: 'Calle 1 # 2-3', address_2: '',
        city, state: 'ANT', postcode: '050001', country: 'CO', email, phone: '+57 300 111 2233',
    });
    const cust = (id, first, last, email, city) => {
        const d = tick();
        return {
            id, date_created: iso(d), date_created_gmt: iso(d), date_modified: iso(d), date_modified_gmt: iso(d),
            email, first_name: first, last_name: last, role: 'customer', username: email.split('@')[0],
            billing: address(first, last, email, city), shipping: address(first, last, '', city),
            is_paying_customer: true, avatar_url: '',
            meta_data: [
                { id: nextId(), key: 'fecha_nacimiento', value: '1990-05-01' },
                { id: nextId(), key: '_wc_last_active', value: '1717000000' },
            ],
        };
    };
    state.customers.push(cust(1, 'Ana', 'García', 'ana@cliente.co', 'Medellín'));
    state.customers.push(cust(2, 'Bruno', 'Díaz', 'bruno@cliente.co', 'Bogotá'));
    state.customers.push(cust(3, 'Carla', 'Ruiz', 'carla@cliente.co', 'Cali'));

    const cat = (id, name) => ({ id, name, slug: name.toLowerCase() });
    const prod = (id, name, extra) => {
        const d = tick();
        return {
            id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), permalink: `http://127.0.0.1:${PORT}/producto/${id}`,
            date_created: iso(d), date_created_gmt: iso(d), date_modified: iso(d), date_modified_gmt: iso(d),
            type: 'simple', status: 'publish', featured: false, catalog_visibility: 'visible',
            description: `<p>Descripción de ${name}</p>`, short_description: '', sku: '', price: '', regular_price: '',
            sale_price: '', on_sale: false, purchasable: true, total_sales: 0, virtual: false, downloadable: false,
            manage_stock: false, stock_quantity: null, stock_status: 'instock', backorders: 'no', weight: '',
            dimensions: { length: '', width: '', height: '' }, categories: [], tags: [], images: [],
            attributes: [], variations: [], meta_data: [], ...extra,
        };
    };
    state.products.push(prod(10, 'Taza de cerámica', {
        sku: 'TAZA-01', price: '20000', regular_price: '25000', sale_price: '20000', on_sale: true,
        manage_stock: true, stock_quantity: 15, categories: [cat(1, 'Cocina'), cat(2, 'Regalos')],
        tags: [{ id: 5, name: 'Nuevo', slug: 'nuevo' }],
        images: [{ id: 50, src: `http://127.0.0.1:${PORT}/img/taza.png`, name: 'taza', alt: '' }],
        meta_data: [
            { id: nextId(), key: '_yoast_wpseo_title', value: 'Taza de cerámica artesanal' },
            { id: nextId(), key: 'garantia_meses', value: '12' },
            { id: nextId(), key: 'ficha_tecnica', value: { material: 'cerámica', capacidad: '350ml' } },
            { id: nextId(), key: '_edit_lock', value: '1717000000:1' },
        ],
    }));
    state.products.push(prod(20, 'Camiseta básica', {
        type: 'variable', sku: 'CAM', price: '45000', categories: [cat(3, 'Ropa')],
        attributes: [
            { id: 1, name: 'Color', position: 0, visible: true, variation: true, options: ['Rojo', 'Azul'] },
            { id: 2, name: 'Talla', position: 1, visible: true, variation: true, options: ['M', 'L'] },
        ],
        variations: [21, 22, 23],
        meta_data: [{ id: nextId(), key: 'garantia_meses', value: '3' }],
    }));
    state.products.push(prod(30, 'Libreta', { sku: 'LIB-01', price: '12000', regular_price: '12000', categories: [cat(4, 'Papelería')] }));
    const vari = (id, color, talla, price, stock) => {
        const d = tick();
        return {
            id, parent_id: 20, date_created: iso(d), date_created_gmt: iso(d), date_modified: iso(d), date_modified_gmt: iso(d),
            description: '', permalink: `http://127.0.0.1:${PORT}/producto/20?v=${id}`, sku: `CAM-${color[0]}${talla}`,
            price, regular_price: price, sale_price: '', on_sale: false, status: 'publish', purchasable: true,
            virtual: false, downloadable: false, manage_stock: true, stock_quantity: stock,
            stock_status: stock > 0 ? 'instock' : 'outofstock', weight: '', dimensions: { length: '', width: '', height: '' },
            image: id === 21 ? { id: 51, src: `http://127.0.0.1:${PORT}/img/rojo-m.png` } : null, attributes: [{ id: 1, name: 'Color', option: color }, { id: 2, name: 'Talla', option: talla }],
            menu_order: 0, meta_data: [{ id: nextId(), key: 'codigo_barras', value: `770${id}` }],
        };
    };
    state.variations[20] = [vari(21, 'Rojo', 'M', '45000', 5), vari(22, 'Rojo', 'L', '45000', 0), vari(23, 'Azul', 'M', '47000', 8)];

    // 250 pedidos: > 2 páginas de 100, mezcla de registrados e invitados.
    const statuses = ['completed', 'completed', 'processing', 'on-hold', 'cancelled', 'pending'];
    for (let i = 0; i < 250; i++) {
        const guest = i % 5 === 4;
        const c = state.customers[i % 3];
        const items = [];
        if (i % 2 === 0) items.push({ product_id: 10, variation_id: 0, name: 'Taza de cerámica', sku: 'TAZA-01', price: 20000, quantity: 1 + (i % 3) });
        if (i % 3 === 0) {
            const v = state.variations[20][Math.floor(i / 3) % 3];
            items.push({ product_id: 20, variation_id: v.id, name: `Camiseta básica - ${v.attributes[0].option}, ${v.attributes[1].option}`, sku: v.sku, price: Number(v.price), quantity: 1 });
        }
        if (items.length === 0) items.push({ product_id: 30, variation_id: 0, name: 'Libreta', sku: 'LIB-01', price: 12000, quantity: 2 });
        state.orders.push(makeOrder({
            status: statuses[i % statuses.length],
            customer_id: guest ? 0 : c.id,
            billing: guest
                ? { ...c.billing, first_name: 'Invitado', last_name: String(i), email: `invitado${i % 7}@correo.co` }
                : c.billing,
            items,
        }));
    }
}

function makeOrder({ status, customer_id, billing, items }) {
    const d = tick(3_600_000);
    const id = nextId();
    const line_items = items.map((it) => ({
        id: nextId(), name: it.name, product_id: it.product_id, variation_id: it.variation_id, quantity: it.quantity,
        tax_class: '', subtotal: String(it.price * it.quantity), subtotal_tax: '0', total: String(it.price * it.quantity),
        total_tax: '0', taxes: [], meta_data: it.variation_id ? [{ id: nextId(), key: 'pa_color', value: 'x' }] : [],
        sku: it.sku, price: it.price, image: { id: '', src: '' }, parent_name: it.variation_id ? 'Camiseta básica' : null,
    }));
    const total = line_items.reduce((s, l) => s + Number(l.total), 0) + 8000;
    return {
        id, parent_id: 0, number: String(id), order_key: `wc_order_${id}`, created_via: 'checkout', version: '9.1.0',
        status, currency: 'COP', date_created: iso(d), date_created_gmt: iso(d), date_modified: iso(d), date_modified_gmt: iso(d),
        discount_total: '0', discount_tax: '0', shipping_total: '8000', shipping_tax: '0', cart_tax: '0',
        total: String(total), total_tax: '0', prices_include_tax: false, customer_id, customer_ip_address: '1.2.3.4',
        customer_user_agent: 'x', customer_note: '', billing, shipping: billing, payment_method: 'bacs',
        payment_method_title: 'Transferencia bancaria', transaction_id: '', date_paid: iso(d), date_paid_gmt: iso(d),
        date_completed: null, date_completed_gmt: null, cart_hash: '',
        meta_data: [
            { id: nextId(), key: '_billing_nit', value: '900123456' },
            { id: nextId(), key: 'origen_pedido', value: 'instagram' },
        ],
        line_items, tax_lines: [], shipping_lines: [{ id: nextId(), method_title: 'Envío nacional', total: '8000' }],
        fee_lines: [], coupon_lines: [], refunds: [], payment_url: '', currency_symbol: '$',
    };
}

const state = {};
reset();

// --- Webhooks ---------------------------------------------------------------

function deliver(topic, payload) {
    const [resource, event] = topic.split('.');
    for (const wh of state.webhooks) {
        if (wh.status !== 'active' || wh.topic !== topic) continue;
        const body = JSON.stringify(payload);
        send(wh, body, 'application/json', { topic, resource, event });
    }
}

function send(wh, body, type, meta) {
    const sig = createHmac('sha256', wh.secret).update(body).digest('base64');
    const url = new URL(wh.delivery_url);
    const headers = {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
        'x-wc-webhook-source': `http://127.0.0.1:${PORT}/`,
        'x-wc-webhook-id': String(wh.id),
        'x-wc-webhook-delivery-id': String(nextId()),
        'x-wc-webhook-signature': sig,
    };
    if (meta) {
        headers['x-wc-webhook-topic'] = meta.topic;
        headers['x-wc-webhook-resource'] = meta.resource;
        headers['x-wc-webhook-event'] = meta.event;
    }
    const req = httpRequest(url, { method: 'POST', headers }, (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => state.deliveries.push({ webhook: wh.id, topic: meta?.topic ?? 'ping', status: res.statusCode, body: out.slice(0, 200) }));
    });
    req.on('error', (e) => state.deliveries.push({ webhook: wh.id, topic: meta?.topic ?? 'ping', status: 0, error: e.message }));
    req.end(body);
}

// --- HTTP -----------------------------------------------------------------

function authOk(req, query) {
    const h = STRIP_AUTH ? undefined : req.headers.authorization;
    if (h && h.startsWith('Basic ')) {
        const [k, s] = Buffer.from(h.slice(6), 'base64').toString().split(':');
        return k === CK && s === CS ? true : 'bad';
    }
    if (query.get('consumer_key')) return query.get('consumer_key') === CK && query.get('consumer_secret') === CS ? true : 'bad';
    return 'none';
}

function page(list, query) {
    let items = list;
    const include = query.get('include');
    if (include) {
        const ids = include.split(',').map(Number);
        items = items.filter((x) => ids.includes(x.id));
    }
    const after = query.get('modified_after');
    if (after) items = items.filter((x) => x.date_modified_gmt > after.replace(/Z$/, '').slice(0, 19));
    const orderby = query.get('orderby');
    if (orderby === 'modified') items = [...items].sort((a, b) => a.date_modified_gmt.localeCompare(b.date_modified_gmt) || a.id - b.id);
    else items = [...items].sort((a, b) => a.id - b.id);
    if (query.get('order') === 'desc') items.reverse();
    const per = Math.min(Number(query.get('per_page') ?? 10), 100);
    const p = Number(query.get('page') ?? 1);
    const total = items.length;
    return { rows: items.slice((p - 1) * per, p * per), total, pages: Math.max(1, Math.ceil(total / per)) };
}

function json(res, status, body, extra = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', ...extra });
    res.end(text);
}

function touch(obj) {
    const d = tick();
    obj.date_modified = iso(d);
    obj.date_modified_gmt = iso(d);
}

function applyMeta(obj, meta) {
    for (const m of meta ?? []) {
        const hit = obj.meta_data.find((x) => x.key === m.key);
        if (hit) hit.value = m.value;
        else obj.meta_data.push({ id: nextId(), key: m.key, value: m.value });
    }
}

async function readBody(req) {
    let raw = '';
    for await (const c of req) raw += c;
    return raw;
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let path = url.pathname;
    if (url.searchParams.get('rest_route')) path = `/wp-json${url.searchParams.get('rest_route')}`;
    const raw = await readBody(req);
    const body = raw && (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : {};
    const q = url.searchParams;

    // Control (sin auth): simula lo que pasa en la tienda.
    // Imágenes de la tienda (v0.1.210): un PNG real y un SVG (que el proxy NO debe servir).
    if (path.startsWith('/img/') && path.endsWith('.png')) {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
        return res.end(png);
    }
    if (path === '/img/evil.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    }
    if (path === '/__control/state') return json(res, 200, { ...state, clock: iso(new Date(clock)) });
    if (path === '/__control/reset') { reset(); return json(res, 200, { ok: true }); }
    if (path === '/__control/new-order') {
        const o = makeOrder({ status: body.status ?? 'processing', customer_id: body.customer_id ?? 1, billing: state.customers[0].billing, items: body.items ?? [{ product_id: 10, variation_id: 0, name: 'Taza de cerámica', sku: 'TAZA-01', price: 20000, quantity: 1 }] });
        if (body.now) {
            o.date_created_gmt = new Date().toISOString().slice(0, 19);
            o.date_created = o.date_created_gmt;
        }
        // Como WooCommerce: la venta BAJA el stock de lo vendido sin tocar la
        // fecha de modificación del producto (por eso la app tiene que leer el
        // stock a partir del pedido).
        for (const it of o.line_items) {
            const target = it.variation_id
                ? (state.variations[it.product_id] ?? []).find((v) => v.id === it.variation_id)
                : state.products.find((p) => p.id === it.product_id);
            if (target && target.manage_stock && typeof target.stock_quantity === 'number') {
                target.stock_quantity -= it.quantity;
                if (target.stock_quantity <= 0) target.stock_status = 'outofstock';
            }
        }
        state.orders.push(o);
        deliver('order.created', o);
        return json(res, 200, o);
    }
    if (path === '/__control/update-product') {
        const p = state.products.find((x) => x.id === body.id);
        Object.assign(p, body.patch ?? {});
        applyMeta(p, body.meta);
        touch(p);
        deliver('product.updated', p);
        return json(res, 200, p);
    }
    if (path === '/__control/update-variation') {
        const v = state.variations[body.parent].find((x) => x.id === body.id);
        Object.assign(v, body.patch ?? {});
        touch(v);
        deliver('product.updated', v);
        return json(res, 200, v);
    }
    if (path === '/__control/update-order') {
        const o = state.orders.find((x) => x.id === body.id);
        Object.assign(o, body.patch ?? {});
        touch(o);
        deliver('order.updated', o);
        return json(res, 200, o);
    }
    if (path === '/__control/delete-product') {
        const p = state.products.find((x) => x.id === body.id);
        state.products = state.products.filter((x) => x.id !== body.id);
        deliver('product.deleted', { id: p.id });
        return json(res, 200, { ok: true });
    }

    if (path === '/wp-json/' || path === '/wp-json') return json(res, 200, { name: 'Tienda Demo', url: `http://127.0.0.1:${PORT}` });
    if (!path.startsWith('/wp-json/wc/v3')) {
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('<html>404</html>');
    }
    const auth = authOk(req, q);
    if (auth !== true) {
        return json(res, 401, auth === 'bad'
            ? { code: 'woocommerce_rest_authentication_error', message: 'Clave de consumidor no válida.', data: { status: 401 } }
            : { code: 'woocommerce_rest_cannot_view', message: 'Lo siento, no puedes listar los recursos.', data: { status: 401 } });
    }
    const r = path.slice('/wp-json/wc/v3'.length);
    const m = (re) => re.exec(r);
    let hit;
    const list = (arr) => {
        const pg = page(arr, q);
        return json(res, 200, pg.rows, { 'x-wp-total': String(pg.total), 'x-wp-totalpages': String(pg.pages) });
    };

    if (r === '/settings/general') return json(res, 200, [{ id: 'woocommerce_currency', value: 'COP' }, { id: 'woocommerce_price_num_decimals', value: '0' }, { id: 'woocommerce_default_country', value: 'CO:ANT' }]);
    if (r === '/settings/products') return json(res, 200, [{ id: 'woocommerce_notify_low_stock_amount', value: '5' }]);
    if (r === '/products' && req.method === 'GET') return list(state.products);
    if ((hit = m(/^\/products\/(\d+)$/))) {
        const p = state.products.find((x) => x.id === Number(hit[1]));
        if (!p) return json(res, 404, { code: 'woocommerce_rest_product_invalid_id', message: 'ID no válido.' });
        if (req.method === 'PUT') {
            const { meta_data, ...rest } = body;
            Object.assign(p, rest);
            applyMeta(p, meta_data);
            if (rest.regular_price !== undefined || rest.sale_price !== undefined) p.price = p.sale_price || p.regular_price;
            touch(p);
            deliver('product.updated', p);
        }
        return json(res, 200, p);
    }
    if ((hit = m(/^\/products\/(\d+)\/variations$/))) return list(state.variations[Number(hit[1])] ?? []);
    if ((hit = m(/^\/products\/(\d+)\/variations\/(\d+)$/))) {
        const v = (state.variations[Number(hit[1])] ?? []).find((x) => x.id === Number(hit[2]));
        if (!v) return json(res, 404, { code: 'woocommerce_rest_product_variation_invalid_id', message: 'ID no válido.' });
        if (req.method === 'PUT') {
            const { meta_data, ...rest } = body;
            Object.assign(v, rest);
            applyMeta(v, meta_data);
            if (rest.regular_price !== undefined || rest.sale_price !== undefined) v.price = v.sale_price || v.regular_price;
            touch(v);
            deliver('product.updated', v);
        }
        return json(res, 200, v);
    }
    if (r === '/orders' && req.method === 'GET') return list(state.orders);
    if ((hit = m(/^\/orders\/(\d+)$/))) {
        const o = state.orders.find((x) => x.id === Number(hit[1]));
        if (!o) return json(res, 404, { code: 'woocommerce_rest_shop_order_invalid_id', message: 'ID no válido.' });
        if (req.method === 'PUT') {
            const { meta_data, ...rest } = body;
            Object.assign(o, rest);
            applyMeta(o, meta_data);
            touch(o);
            deliver('order.updated', o);
        }
        return json(res, 200, o);
    }
    if ((hit = m(/^\/orders\/(\d+)\/notes$/)) && req.method === 'POST') {
        const n = { id: nextId(), order: Number(hit[1]), note: body.note, customer_note: body.customer_note };
        state.notes.push(n);
        return json(res, 201, n);
    }
    if (r === '/customers' && req.method === 'GET') return list(state.customers);
    if (r === '/coupons' && req.method === 'POST') {
        const c = { id: nextId(), ...body };
        state.coupons.push(c);
        return json(res, 201, c);
    }
    if (r === '/webhooks' && req.method === 'GET') return list(state.webhooks);
    if (r === '/webhooks' && req.method === 'POST') {
        const wh = { id: nextId(), name: body.name, status: body.status ?? 'active', topic: body.topic, delivery_url: body.delivery_url, secret: body.secret || randomBytes(8).toString('hex') };
        state.webhooks.push(wh);
        // WooCommerce manda un «ping» form-urlencoded al crear el webhook.
        send(wh, `webhook_id=${wh.id}`, 'application/x-www-form-urlencoded', null);
        return json(res, 201, { ...wh, secret: undefined });
    }
    if ((hit = m(/^\/webhooks\/(\d+)$/)) && req.method === 'DELETE') {
        state.webhooks = state.webhooks.filter((w) => w.id !== Number(hit[1]));
        return json(res, 200, { id: Number(hit[1]) });
    }
    return json(res, 404, { code: 'rest_no_route', message: 'No se encontró ninguna ruta.' });
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake-woo en http://127.0.0.1:${PORT} (strip_auth=${STRIP_AUTH})`));
