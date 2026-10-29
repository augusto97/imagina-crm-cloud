// Doble de los 5 proveedores de SMS (ADR-S82) para el E2E y las pruebas a mano.
//
//   node scripts/dev/fake-sms.mjs [puerto=4897]
//
// Imita lo que la app usa de cada API: envío, consulta de cuenta/saldo, los
// errores típicos y los avisos de entrega. Credenciales que acepta:
//   Twilio      Account SID ACe2e00000000000000000000000000000 · token twilio-token-bueno
//   BulkGate    Application ID e2e-app · token bulkgate-token-bueno
//   Infobip     URL base http://127.0.0.1:<puerto>/infobip · clave infobip-key-buena
//   LabsMobile  usuario e2e-user · token labs-token-bueno
//   Onurix      Client ID e2e-client · Key onurix-key-buena
// Un destino que termina en 0000 se rechaza (número inválido).
//
// Para las pruebas:
//   GET  /__state                          → lo que se mandó (y los avisos disparados)
//   POST /__dlr {provider, status, id?, url?}
//        dispara el aviso de entrega del último SMS (o el de `id`) de ese proveedor.
//        status: delivered | failed | sent. BulkGate no guarda URL por mensaje: pásala en `url`.
//        Onurix no avisa: el estado queda para su consulta (`messages-state`).
//   POST /__reset                          → borra el estado
import { createHmac } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 4897);
const TWILIO_SID = 'ACe2e00000000000000000000000000000';
const TWILIO_TOKEN = 'twilio-token-bueno';

let state = { sent: [], dlrs: [] };
let n = 0;

const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};
const basicOf = (req) => {
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('Basic ')) return null;
    const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    return { user: u, pass: p.join(':') };
};
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const badNumber = (to) => digits(to).endsWith('0000');
function segments(text) {
    // Aproximado (el contador de verdad vive en la app): 160/153 o 70/67.
    const ucs = /[^\n\r !"#$%&'()*+,\-./0-9:;<=>?@A-Z_a-z¡£¤¥§¿ÄÅÆÇÉÑÖØÜßàäåæèéìñòöøùü^{}\\[~\]|€]/.test(text);
    const per = ucs ? 70 : 160;
    const multi = ucs ? 67 : 153;
    const len = [...text].length;
    return len <= per ? 1 : Math.ceil(len / multi);
}
function twilioSignature(token, url, params) {
    let data = url;
    for (const k of Object.keys(params).sort()) data += k + params[k];
    return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
}

async function post(url, { form, body, headers = {} }) {
    const payload = form ? new URLSearchParams(form).toString() : body !== undefined ? JSON.stringify(body) : undefined;
    const ct = form ? 'application/x-www-form-urlencoded' : 'application/json';
    try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': ct, ...headers }, body: payload });
        return { status: r.status, body: await r.text() };
    } catch (err) {
        return { status: 0, body: String(err) };
    }
}

async function fireDlr({ provider, status, id, url }) {
    const list = state.sent.filter((m) => m.provider === provider);
    const msg = id ? list.find((m) => m.id === id) : list[list.length - 1];
    if (!msg) return { ok: false, error: 'no hay SMS de ese proveedor' };
    msg.state = status;
    let r = { status: 0, body: '' };
    if (provider === 'twilio') {
        const target = url ?? msg.callback;
        if (!target) return { ok: false, error: 'el SMS no tenía StatusCallback' };
        const form = { MessageSid: msg.id, MessageStatus: status === 'failed' ? 'undelivered' : status, AccountSid: TWILIO_SID, To: msg.to };
        if (status === 'failed') form.ErrorCode = '30003';
        r = await post(target, { form, headers: { 'x-twilio-signature': twilioSignature(TWILIO_TOKEN, target, form) } });
    } else if (provider === 'bulkgate') {
        if (!url) return { ok: false, error: 'BulkGate: pasa la URL de avisos en `url`' };
        const code = status === 'delivered' ? 1 : status === 'failed' ? 3 : 2;
        const u = new URL(url);
        u.searchParams.set('status', String(code));
        u.searchParams.set('smsID', msg.id);
        u.searchParams.set('price', '1');
        try {
            const res = await fetch(u, { method: 'GET' });
            r = { status: res.status, body: await res.text() };
        } catch (err) {
            r = { status: 0, body: String(err) };
        }
    } else if (provider === 'infobip') {
        const target = url ?? msg.callback;
        if (!target) return { ok: false, error: 'el SMS no tenía webhook de entrega' };
        const st =
            status === 'delivered'
                ? { groupId: 3, groupName: 'DELIVERED', id: 5, name: 'DELIVERED_TO_HANDSET', description: 'Message delivered to handset' }
                : status === 'failed'
                  ? { groupId: 2, groupName: 'UNDELIVERABLE', id: 9, name: 'UNDELIVERABLE_NOT_DELIVERED', description: 'Message sent not delivered' }
                  : { groupId: 1, groupName: 'PENDING', id: 7, name: 'PENDING_ENROUTE', description: 'Message sent to next instance' };
        r = await post(target, {
            body: {
                results: [
                    {
                        messageId: msg.id,
                        to: msg.to,
                        sentAt: new Date().toISOString(),
                        doneAt: new Date().toISOString(),
                        messageCount: msg.segments,
                        status: st,
                        error: { groupId: 0, groupName: 'OK', id: 0, name: 'NO_ERROR', description: 'No Error', permanent: false },
                        callbackData: msg.ref,
                    },
                ],
            },
        });
    } else if (provider === 'labsmobile') {
        const target = url ?? msg.callback;
        if (!target) return { ok: false, error: 'el SMS no tenía ackurl' };
        const u = new URL(target);
        u.searchParams.set('acklevel', status === 'delivered' ? 'handset' : 'operator');
        u.searchParams.set('msisdn', digits(msg.to));
        u.searchParams.set('status', status === 'failed' ? 'ko' : 'ok');
        u.searchParams.set('desc', status === 'failed' ? 'Unknown subscriber' : 'Delivered');
        u.searchParams.set('subid', msg.id);
        u.searchParams.set('timestamp', new Date().toISOString());
        try {
            const res = await fetch(u, { method: 'GET' });
            r = { status: res.status, body: await res.text() };
        } catch (err) {
            r = { status: 0, body: String(err) };
        }
    } else if (provider === 'onurix') {
        // Sin aviso: la app lo consulta.
        r = { status: 200, body: 'onurix: estado listo para la consulta' };
    }
    state.dlrs.push({ provider, id: msg.id, status, response: r });
    return { ok: r.status >= 200 && r.status < 300, response: r };
}

http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
        const u = new URL(req.url, 'http://x');
        const p = u.pathname;
        const ct = String(req.headers['content-type'] ?? '');
        let body = null;
        if (raw) {
            if (ct.includes('application/json')) {
                try {
                    body = JSON.parse(raw);
                } catch {
                    body = null;
                }
            } else body = Object.fromEntries(new URLSearchParams(raw));
        }

        if (p === '/__state') return json(res, 200, state);
        if (p === '/__reset' && req.method === 'POST') {
            state = { sent: [], dlrs: [] };
            return json(res, 200, {});
        }
        if (p === '/__dlr' && req.method === 'POST') return json(res, 200, await fireDlr(body ?? {}));

        // ── Twilio ──────────────────────────────────────────────────────
        let m;
        if ((m = p.match(/^\/twilio\/2010-04-01\/Accounts\/([^/]+?)(\/Messages)?\.json$/))) {
            const a = basicOf(req);
            if (!a || a.user !== m[1] || m[1] !== TWILIO_SID || a.pass !== TWILIO_TOKEN) {
                return json(res, 401, { code: 20003, message: 'Authenticate', more_info: 'https://www.twilio.com/docs/errors/20003', status: 401 });
            }
            if (!m[2]) return json(res, 200, { sid: TWILIO_SID, friendly_name: 'Cuenta E2E', status: 'active', type: 'Full' });
            if (badNumber(body?.To)) {
                return json(res, 400, { code: 21211, message: "The 'To' number is not a valid phone number.", more_info: 'https://www.twilio.com/docs/errors/21211', status: 400 });
            }
            const sid = `SM${String(++n).padStart(32, '0')}`;
            const seg = segments(body?.Body ?? '');
            state.sent.push({ provider: 'twilio', id: sid, to: body?.To, text: body?.Body, from: body?.From ?? body?.MessagingServiceSid, callback: body?.StatusCallback ?? null, segments: seg, state: 'queued' });
            return json(res, 201, { sid, status: 'queued', to: body?.To, from: body?.From ?? null, body: body?.Body, num_segments: String(seg), error_code: null, error_message: null });
        }

        // ── BulkGate ────────────────────────────────────────────────────
        if (p === '/bulkgate/api/1.0/simple/info' || p === '/bulkgate/api/1.0/simple/transactional') {
            if (body?.application_id !== 'e2e-app' || body?.application_token !== 'bulkgate-token-bueno') {
                return json(res, 401, { type: 'unknown_identity', code: 401, error: 'Unknown identity / unauthorized / empty application_id', detail: null });
            }
            if (p.endsWith('/info')) return json(res, 200, { data: { wallet: 'bg1805151838000001', credit: 215.8138, currency: 'credits', free_messages: 51, datetime: new Date().toISOString() } });
            if (badNumber(body?.number)) return json(res, 400, { type: 'invalid_phone_number', code: 400, error: 'Invalid phone number', detail: null });
            const id = `idx${++n}`;
            state.sent.push({ provider: 'bulkgate', id, to: body?.number, text: body?.text, from: body?.sender_id_value ?? body?.sender_id, unicode: body?.unicode, ref: body?.tag, segments: segments(body?.text ?? ''), state: 'accepted' });
            return json(res, 200, { data: { status: 'accepted', sms_id: id, price: 1, credit: 214.8, number: body?.number } });
        }

        // ── Infobip ─────────────────────────────────────────────────────
        if (p.startsWith('/infobip/')) {
            if (req.headers.authorization !== 'App infobip-key-buena') {
                return json(res, 401, { requestError: { serviceException: { messageId: 'UNAUTHORIZED', text: 'Invalid login details' } } });
            }
            if (p === '/infobip/account/1/balance') return json(res, 200, { balance: 47.79, currency: 'EUR' });
            if (p === '/infobip/sms/3/messages' && req.method === 'POST') {
                const msg = body?.messages?.[0] ?? {};
                const dest = msg.destinations?.[0] ?? {};
                if (badNumber(dest.to)) {
                    return json(res, 200, {
                        bulkId: `bulk-${n}`,
                        messages: [{ messageId: dest.messageId ?? `ib${++n}`, status: { groupId: 5, groupName: 'REJECTED', id: 51, name: 'REJECTED_INVALID_DESTINATION', description: 'Invalid destination address' }, destination: dest.to }],
                    });
                }
                const id = dest.messageId ?? `ib${++n}`;
                const seg = segments(msg.content?.text ?? '');
                state.sent.push({ provider: 'infobip', id, to: dest.to, text: msg.content?.text, from: msg.sender, callback: msg.webhooks?.delivery?.url ?? null, ref: msg.webhooks?.callbackData ?? null, segments: seg, state: 'pending' });
                return json(res, 200, {
                    bulkId: `bulk-${n}`,
                    messages: [{ messageId: id, status: { groupId: 1, groupName: 'PENDING', id: 26, name: 'PENDING_ACCEPTED', description: 'Message sent to next instance' }, destination: dest.to, details: { messageCount: seg } }],
                });
            }
            return json(res, 404, {});
        }

        // ── LabsMobile ──────────────────────────────────────────────────
        if (p === '/labsmobile/json/balance' || p === '/labsmobile/json/send') {
            const a = basicOf(req);
            if (!a || a.user !== 'e2e-user' || a.pass !== 'labs-token-bueno') return json(res, 401, { code: 401, message: 'Unauthorized' });
            if (p.endsWith('/balance')) return json(res, 200, { code: 0, credits: '120.5' });
            const to = body?.recipient?.[0]?.msisdn;
            if (badNumber(to)) return json(res, 200, { code: '27', message: 'The message does not have a valid recipient.' });
            const id = body?.subid || `lm${++n}`;
            state.sent.push({ provider: 'labsmobile', id, to, text: body?.message, from: body?.tpoa, callback: body?.ackurl ?? null, ucs2: body?.ucs2, segments: segments(body?.message ?? ''), state: 'sent' });
            return json(res, 200, { code: '0', message: 'Message has been successfully sent.', subid: id });
        }

        // ── Onurix ──────────────────────────────────────────────────────
        if (p.startsWith('/onurix/api/v1/')) {
            const params = req.method === 'GET' ? Object.fromEntries(u.searchParams) : (body ?? {});
            if (params.client !== 'e2e-client' || params.key !== 'onurix-key-buena') return json(res, 200, { error: 1001, msg: 'El cliente no existe o la key no coincide' });
            if (p === '/onurix/api/v1/balance') return json(res, 200, { balance: 250 });
            if (p === '/onurix/api/v1/sms/send') {
                if (badNumber(params.phone)) return json(res, 200, { error: 1007, msg: 'Número de teléfono no válido' });
                const id = String(9000 + ++n);
                const seg = segments(params.sms ?? '');
                state.sent.push({ provider: 'onurix', id, to: params.phone, text: params.sms, segments: seg, state: 'sent' });
                return json(res, 200, { status: 1, id, data: [{ id: `${id}-1`, state: 'Enviado', credits: seg, sms: params.sms, phone: params.phone }] });
            }
            if (p === '/onurix/api/v1/messages-state') {
                const msg = state.sent.find((x) => x.provider === 'onurix' && x.id === params.id);
                if (!msg) return json(res, 200, { error: 1100, msg: 'No existe el envío' });
                const label = msg.state === 'delivered' ? 'Entregado' : msg.state === 'failed' ? 'No entregado' : 'Enviado';
                return json(res, 200, { data: [{ id: msg.id, state: label, phone: msg.to }] });
            }
            return json(res, 404, {});
        }
        json(res, 404, {});
    });
}).listen(PORT, '127.0.0.1', () => console.log(`fake-sms en http://127.0.0.1:${PORT}`));
