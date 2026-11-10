// Doble de WAS v1 (whats.imagina.cloud) para el E2E y las pruebas a mano
// (v0.1.389). Imita lo que la app usa de la API: /me, los números, los avisos
// (webhooks) y el envío, con la forma documentada y los errores típicos.
//
//   node scripts/dev/fake-was.mjs [puerto=4899]
//
// En la conexión: «Servidor» = http://127.0.0.1:<puerto> (opciones avanzadas).
// Claves que acepta:
//   was-clave-buena       todos los permisos
//   was-clave-sin-avisos  sin «webhooks.manage» ni «wa.read» (envía igual)
//   was-clave-sin-envio   sin «wa.send»
// Números: #1 +57 317 833 9119 (conectado) y #2 +57 300 555 0142 (desconectado).
// Un destino que termina en 0000 se rechaza («no tiene WhatsApp»).
//
// Para las pruebas:
//   GET  /__state                              → mensajes, avisos registrados (con sus eventos) y entregas
//   POST /__status {status, id?, failure_reason?}
//        manda el aviso firmado del último mensaje (o el de `id`):
//        sent | delivered | read | failed | canceled
//   POST /__inbound {from, text?, account?, type?, caption?}
//        manda el aviso de un mensaje que te escriben
//   POST /__account {id, status, is_enabled?}  → cambia el estado de un número
//   POST /__reset                              → borra todo
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 4899);
const ALL = ['account.view', 'wa.accounts.view', 'wa.send', 'wa.read', 'webhooks.manage'];
const KEYS = {
    'was-clave-buena': ALL,
    'was-clave-sin-avisos': ['account.view', 'wa.accounts.view', 'wa.send'],
    'was-clave-sin-envio': ['account.view', 'wa.accounts.view', 'wa.read', 'webhooks.manage'],
};

function fresh() {
    return {
        accounts: [
            { id: 1, phone: '+573178339119', display_name: 'Café Aurora', status: 'connected', is_enabled: true },
            { id: 2, phone: '+573005550142', display_name: 'Bodega', status: 'disconnected', is_enabled: true },
        ],
        hooks: [],
        messages: [],
        deliveries: [],
    };
}
let state = fresh();
// Ids que no se repiten entre arranques (la app recuerda los mensajes ya procesados).
let nextMsg = Date.now() % 1_000_000_000;
let nextHook = 1;

function send(res, status, body) {
    if (status === 204) {
        res.writeHead(204);
        return res.end();
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}
const error = (res, status, code, message, details = {}) => send(res, status, { error: { code, message, details } });

function readBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            try {
                resolve(raw === '' ? {} : JSON.parse(raw));
            } catch {
                resolve({});
            }
        });
    });
}

async function deliver(event, payload) {
    const body = JSON.stringify({ id: `dlv_${randomBytes(6).toString('hex')}`, event, payload, sent_at: new Date().toISOString() });
    const out = [];
    for (const h of state.hooks.filter((x) => x.is_active && x.events.includes(event))) {
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', h.secret).update(`${t}.${body}`).digest('hex');
        let status = 0;
        try {
            const r = await fetch(h.url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-webhook-signature': `t=${t},v1=${sig}`,
                    'x-webhook-timestamp': String(t),
                    'x-webhook-event': event,
                    'x-webhook-delivery-id': JSON.parse(body).id,
                },
                body,
            });
            status = r.status;
        } catch (e) {
            status = -1;
            console.error('[fake-was] entrega falló', String(e));
        }
        out.push({ hook: h.id, url: h.url, event, status });
    }
    state.deliveries.push(...out);
    return out;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const path = url.pathname;
    const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};

    // ── Controles de la prueba ──
    if (path === '/__state') return send(res, 200, state);
    if (path === '/__reset') {
        state = fresh();
        return send(res, 200, { ok: true });
    }
    if (path === '/__account') {
        const a = state.accounts.find((x) => x.id === Number(body.id));
        if (!a) return send(res, 404, { ok: false });
        if (body.status) a.status = String(body.status);
        if (typeof body.is_enabled === 'boolean') a.is_enabled = body.is_enabled;
        return send(res, 200, a);
    }
    if (path === '/__status') {
        const m = body.id ? state.messages.find((x) => String(x.id) === String(body.id)) : state.messages.at(-1);
        if (!m) return send(res, 404, { ok: false, error: 'no hay mensajes' });
        const st = String(body.status ?? 'delivered');
        const now = new Date().toISOString();
        m.status = st;
        if (st === 'sent') m.sent_at = now;
        if (st === 'delivered') m.delivered_at = now;
        if (st === 'read') m.read_at = now;
        if (st === 'failed' || st === 'canceled') m.failure_reason = body.failure_reason ?? 'no_whatsapp';
        return send(res, 200, { delivered: await deliver(`wa.message.${st}`, m) });
    }
    if (path === '/__inbound') {
        const account = Number(body.account ?? 1);
        const m = {
            id: nextMsg++,
            channel: 'wa',
            direction: 'inbound',
            connection: { type: 'wa', id: account },
            from: String(body.from ?? '+573001112233'),
            to: state.accounts.find((a) => a.id === account)?.phone ?? '',
            type: String(body.type ?? 'text'),
            body: body.text ?? 'Hola, ¿tienen disponibilidad mañana?',
            caption: body.caption ?? null,
            attachment: body.type && body.type !== 'text' ? { url: null, mime: 'application/pdf', name: 'archivo.pdf' } : null,
            status: 'received',
            created_at: new Date().toISOString(),
        };
        return send(res, 200, { delivered: await deliver('wa.message.received', m) });
    }

    // ── API v1 ──
    if (!path.startsWith('/api/v1/')) return error(res, 404, 'not_found', 'No existe.');
    const auth = String(req.headers.authorization ?? '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const abilities = KEYS[key];
    if (!abilities) return error(res, 401, 'unauthenticated', 'Unauthenticated.');
    const need = (ability) => {
        if (abilities.includes(ability)) return true;
        error(res, 403, 'missing_ability', `This key lacks the ${ability} ability.`, { ability });
        return false;
    };
    const p = path.slice('/api/v1'.length);

    if (p === '/me' && req.method === 'GET') {
        return send(res, 200, {
            data: { workspace: { id: 7, name: 'Café Aurora' }, plan: { name: 'Pro', features: { api: true, wa: true } }, token: { name: 'Imagina Base', abilities } },
        });
    }
    if (p === '/whatsapp/accounts' && req.method === 'GET') {
        if (!need('wa.accounts.view')) return;
        return send(res, 200, { data: state.accounts });
    }
    const acc = /^\/whatsapp\/accounts\/(\d+)$/.exec(p);
    if (acc && req.method === 'GET') {
        if (!need('wa.accounts.view')) return;
        const a = state.accounts.find((x) => x.id === Number(acc[1]));
        return a ? send(res, 200, { data: a }) : error(res, 404, 'not_found', 'WhatsApp account not found.');
    }
    if (p === '/webhooks' && req.method === 'POST') {
        if (!need('webhooks.manage')) return;
        const h = { id: nextHook++, name: String(body.name ?? ''), url: String(body.url ?? ''), events: body.events ?? [], is_active: body.is_active !== false, secret: `whsec_${randomBytes(16).toString('hex')}` };
        state.hooks.push(h);
        return send(res, 201, { id: h.id, name: h.name, url: h.url, events: h.events, is_active: h.is_active, secret: h.secret });
    }
    const hk = /^\/webhooks\/(\d+)$/.exec(p);
    if (hk) {
        if (!need('webhooks.manage')) return;
        const i = state.hooks.findIndex((x) => x.id === Number(hk[1]));
        if (i < 0) return error(res, 404, 'not_found', 'Webhook not found.');
        if (req.method === 'DELETE') {
            state.hooks.splice(i, 1);
            return send(res, 204);
        }
        const h = state.hooks[i];
        if (req.method === 'PATCH') {
            const patch = await readBody(req);
            if (Array.isArray(patch.events)) {
                if (patch.events.length === 0) return error(res, 422, 'validation_failed', 'The given data was invalid.', { fields: { events: ['At least one event.'] } });
                h.events = patch.events.map(String);
            }
            if (typeof patch.name === 'string') h.name = patch.name;
            if (typeof patch.url === 'string') h.url = patch.url;
            h.patches = (h.patches ?? 0) + 1;
        }
        return send(res, 200, { data: { id: h.id, name: h.name, url: h.url, events: h.events, is_active: h.is_active } });
    }
    if (p === '/messages/whatsapp' && req.method === 'POST') {
        if (!need('wa.send')) return;
        const a = state.accounts.find((x) => x.id === Number(body.wa_account_id));
        if (!a) return error(res, 422, 'validation_failed', 'The given data was invalid.', { fields: { wa_account_id: ['Invalid account.'] } });
        if (!a.is_enabled || a.status !== 'connected') return error(res, 409, 'account_disconnected', 'The WhatsApp account is not connected.');
        const to = String(body.to ?? '');
        if (!/^\+\d{8,15}$/.test(to)) return error(res, 422, 'validation_failed', 'The given data was invalid.', { fields: { to: ['Invalid phone number.'] } });
        if (to.endsWith('0000')) return error(res, 422, 'not_on_whatsapp', 'The recipient is not on WhatsApp.');
        if (body.type === 'media' && !/^https:\/\//.test(String(body.media_url ?? ''))) {
            return error(res, 422, 'validation_failed', 'The given data was invalid.', { fields: { media_url: ['Must be https.'] } });
        }
        const m = {
            id: nextMsg++,
            channel: 'wa',
            direction: 'outbound',
            connection: { type: 'wa', id: a.id },
            from: a.phone,
            to,
            type: body.type ?? 'text',
            body: body.body ?? null,
            media_url: body.media_url ?? null,
            reference: body.reference ?? null,
            status: 'queued',
            created_at: new Date().toISOString(),
        };
        state.messages.push(m);
        return send(res, 202, { data: m });
    }
    return error(res, 404, 'not_found', 'No existe.');
});

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-was] escuchando en http://127.0.0.1:${PORT}`));
