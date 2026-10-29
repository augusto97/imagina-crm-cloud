import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SmsProviderKey, SmsStatus } from '@imagina-base/shared';

/**
 * v0.1.332 (ADR-S82) — Las peticiones de los cinco proveedores de SMS.
 *
 * PURO, igual que `buildIntegrationRequest` y `whatsapp-graph`: el envío desde
 * la ficha, el masivo, la automatización y la prueba arman EXACTAMENTE la misma
 * petición, y los tests la verifican contra las respuestas reales de la
 * documentación de cada proveedor sin salir a la red.
 *
 * Fuentes (oficiales): Twilio Messages API + seguridad de webhooks
 * (X-Twilio-Signature), BulkGate Simple API (transactional, info) y sus
 * reportes de entrega, Infobip `/sms/3/messages` con `webhooks.delivery`,
 * LabsMobile JSON API (`/json/send`, `/json/balance`, ackurl) y Onurix
 * (`/api/v1/sms/send`, `/api/v1/balance`, `/api/v1/messages-state`). Lo que la
 * documentación no deja confirmar está marcado como SUPUESTO al lado del código.
 */

export interface SmsCreds {
    /** El dato secreto de la conexión (Auth Token, token, clave de API, Key). */
    secret: string;
    /** Los datos no secretos (SID, application id, URL base, remitente…). */
    fields: Record<string, string>;
}

/** Bases de cada API (los tests las apuntan a un servidor falso). */
export interface SmsBases {
    twilio: string;
    bulkgate: string;
    labsmobile: string;
    onurix: string;
}

export const DEFAULT_SMS_BASES: SmsBases = {
    twilio: 'https://api.twilio.com',
    bulkgate: 'https://portal.bulkgate.com',
    labsmobile: 'https://api.labsmobile.com',
    onurix: 'https://www.onurix.com',
};

export interface SmsHttpRequest {
    method: 'GET' | 'POST';
    url: string;
    headers: Record<string, string>;
    body?: string;
}

export interface SmsSendInput {
    /** E.164 con `+`. */
    to: string;
    text: string;
    /** Remitente (vacío = el de la conexión o el del proveedor). */
    sender: string;
    /** El texto no entra en GSM-7. */
    unicode: boolean;
    segments: number;
    /** La URL de avisos, para los que la aceptan por mensaje (null = no pedir). */
    callbackUrl: string | null;
    /** Id propio del envío: viaja como `subid` (LabsMobile) o `messageId` (Infobip). */
    reference: string;
}

export type SmsSendOutcome =
    | { ok: true; providerId: string | null; status: 'enviado' | 'entregado'; segments: number | null }
    | { ok: false; error: string; /** De la cuenta (credencial, saldo, remitente): abre un Problema. */ systemic: boolean; code: string | null };

export interface SmsVerifyOutcome {
    ok: boolean;
    label: string | null;
    error: string | null;
    warning: string | null;
}

/** Lo que llega al endpoint público de avisos. */
export interface SmsDlrRequest {
    method: string;
    query: Record<string, unknown>;
    body: unknown;
    headers: Record<string, string | undefined>;
    /** La URL de avisos EXACTA que le dimos al proveedor (Twilio firma sobre ella). */
    url: string;
}

export interface SmsDeliveryUpdate {
    /** Ids posibles del mensaje en el proveedor (el primero que coincida gana). */
    providerIds: string[];
    /** Nuestra referencia, si el proveedor la devuelve. */
    reference: string | null;
    status: SmsStatus;
    error: string | null;
}

export interface SmsProvider {
    key: SmsProviderKey;
    buildSend(input: SmsSendInput, creds: SmsCreds, bases: SmsBases): SmsHttpRequest;
    parseSend(status: number, body: string): SmsSendOutcome;
    buildVerify(creds: SmsCreds, bases: SmsBases): SmsHttpRequest;
    parseVerify(status: number, body: string, creds: SmsCreds): SmsVerifyOutcome;
    parseDeliveryReport(req: SmsDlrRequest): SmsDeliveryUpdate[];
    /** ¿El aviso es auténtico? Sólo Twilio firma; el resto se protege con el token de la URL. */
    verifyDeliveryReport(req: SmsDlrRequest, creds: SmsCreds): boolean;
    /** Onurix no avisa: se pregunta el estado. */
    buildStatusPoll?(providerId: string, creds: SmsCreds, bases: SmsBases): SmsHttpRequest;
    parseStatusPoll?(status: number, body: string): SmsDeliveryUpdate | null;
}

// ── Utilidades ───────────────────────────────────────────────────────────

function parseJson(body: string): Record<string, unknown> | null {
    try {
        const v: unknown = JSON.parse(body);
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function obj(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function form(pairs: Array<[string, string]>): string {
    return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function basic(user: string, pass: string): string {
    return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

function digits(e164: string): string {
    return e164.replace(/\D/g, '');
}

function trimBase(raw: string): string {
    return raw.trim().replace(/\/+$/, '');
}

/** Valor de un aviso que puede venir en la query o en el cuerpo (form o JSON). */
function pick(req: SmsDlrRequest, key: string): string {
    const q = str(req.query[key]);
    if (q !== '') return q;
    return str(obj(req.body)[key]);
}

function money(n: unknown): string | null {
    const v = typeof n === 'number' ? n : Number(str(n));
    if (!Number.isFinite(v)) return null;
    return v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' };
const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };

// ── Twilio ───────────────────────────────────────────────────────────────

/**
 * Códigos de error de Twilio que se ven seguido. Los de la cuenta (credencial,
 * remitente, cuenta suspendida) son «sistémicos»: fallan para todos y abren un
 * Problema. Los del destinatario no.
 */
const TWILIO_ERRORS: Record<number, { text: string; systemic: boolean }> = {
    20003: { text: 'Twilio no reconoce el Account SID o el Auth Token: revísalos en Ajustes → Integraciones.', systemic: true },
    20005: { text: 'La cuenta de Twilio no está activa (suspendida o cerrada).', systemic: true },
    20429: { text: 'Twilio está limitando los envíos (demasiadas peticiones): se reintenta más tarde.', systemic: false },
    21211: { text: 'El número de destino no es válido.', systemic: false },
    21212: { text: 'El remitente no es un número válido de tu cuenta de Twilio: revisa el «Remitente» de la conexión.', systemic: true },
    21408: { text: 'Tu cuenta de Twilio no tiene habilitado ese país (Messaging → Settings → Geo permissions).', systemic: false },
    21606: { text: 'El remitente no puede mandar SMS: elige un número de Twilio con SMS o un servicio de mensajería.', systemic: true },
    21608: { text: 'Tu cuenta de Twilio es de prueba: sólo manda a números verificados en Twilio.', systemic: false },
    21610: { text: 'Ese número pidió no recibir más mensajes (respondió STOP).', systemic: false },
    21612: { text: 'Twilio no puede llevar el SMS a ese número desde este remitente.', systemic: false },
    21614: { text: 'El número de destino no puede recibir SMS (no es un celular).', systemic: false },
    21617: { text: 'El mensaje es demasiado largo para Twilio.', systemic: false },
    21659: { text: 'El remitente no es de tu cuenta de Twilio: revisa el «Remitente» de la conexión.', systemic: true },
    30003: { text: 'El teléfono de destino no está disponible (apagado o fuera de cobertura).', systemic: false },
    30004: { text: 'El destinatario bloqueó el mensaje.', systemic: false },
    30005: { text: 'El número de destino no existe.', systemic: false },
    30006: { text: 'El número de destino es un fijo o su operador no recibe SMS.', systemic: false },
    30007: { text: 'El operador filtró el mensaje como spam.', systemic: false },
    30008: { text: 'El operador no entregó el mensaje (error desconocido).', systemic: false },
};

export function twilioErrorText(code: number | null, message: string): { text: string; systemic: boolean } {
    if (code !== null && TWILIO_ERRORS[code]) return TWILIO_ERRORS[code]!;
    if (/balance|insufficient|funds/i.test(message)) return { text: 'La cuenta de Twilio no tiene saldo: recárgala para seguir mandando.', systemic: true };
    const said = message.trim() !== '' ? `: «${message.trim()}»` : '';
    return { text: `Twilio rechazó el SMS${code !== null ? ` (error ${code})` : ''}${said}`, systemic: false };
}

const twilioSid = (creds: SmsCreds): string => (creds.fields.account_sid ?? '').trim();

/** Firma de Twilio: base64(HMAC-SHA1(token, url + clave1 + valor1 + … en orden alfabético)). */
export function twilioSignature(token: string, url: string, params: Record<string, unknown>): string {
    let data = url;
    for (const key of Object.keys(params).sort()) {
        const v = params[key];
        const values = Array.isArray(v) ? v : [v];
        for (const one of values) data += key + str(one);
    }
    return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
}

const twilio: SmsProvider = {
    key: 'sms_twilio',
    buildSend(input, creds, bases) {
        const sid = twilioSid(creds);
        const sender = (input.sender || creds.fields.from || '').trim();
        const pairs: Array<[string, string]> = [
            ['To', input.to],
            ['Body', input.text],
        ];
        // Un servicio de mensajería (MG + 32) elige el número del pool; si no, `From`.
        if (/^MG[0-9a-f]{32}$/i.test(sender)) pairs.push(['MessagingServiceSid', sender]);
        else pairs.push(['From', sender]);
        if (input.callbackUrl) pairs.push(['StatusCallback', input.callbackUrl]);
        return {
            method: 'POST',
            url: `${trimBase(bases.twilio)}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
            headers: { ...FORM_HEADERS, authorization: basic(sid, creds.secret) },
            body: form(pairs),
        };
    },
    parseSend(status, body) {
        const json = parseJson(body);
        if (status >= 200 && status < 300 && json && typeof json.sid === 'string') {
            const st = str(json.status).toLowerCase();
            if (st === 'failed' || st === 'undelivered') {
                const e = twilioErrorText(Number(json.error_code) || null, str(json.error_message));
                return { ok: false, error: e.text, systemic: e.systemic, code: str(json.error_code) || null };
            }
            const seg = Number(json.num_segments);
            return { ok: true, providerId: json.sid, status: st === 'delivered' ? 'entregado' : 'enviado', segments: Number.isFinite(seg) && seg > 0 ? seg : null };
        }
        const code = json && Number.isFinite(Number(json.code)) ? Number(json.code) : null;
        if (status === 401) return { ok: false, error: TWILIO_ERRORS[20003]!.text, systemic: true, code: code !== null ? String(code) : '401' };
        const e = twilioErrorText(code, json ? str(json.message) : `HTTP ${status}`);
        return { ok: false, error: e.text, systemic: e.systemic, code: code !== null ? String(code) : String(status) };
    },
    buildVerify(creds, bases) {
        const sid = twilioSid(creds);
        return {
            method: 'GET',
            url: `${trimBase(bases.twilio)}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
            headers: { accept: 'application/json', authorization: basic(sid, creds.secret) },
        };
    },
    parseVerify(status, body, creds) {
        const out: SmsVerifyOutcome = { ok: true, label: null, error: null, warning: null };
        if (!/^AC[0-9a-f]{32}$/i.test(twilioSid(creds))) {
            return { ...out, ok: false, error: 'El Account SID empieza con AC y tiene 34 caracteres: cópialo de la portada de console.twilio.com.' };
        }
        if (status === 401 || status === 404) return { ...out, ok: false, error: TWILIO_ERRORS[20003]!.text };
        const json = parseJson(body);
        if (status !== 200 || !json) {
            return { ...out, warning: `No pudimos comprobar la cuenta de Twilio ahora (respuesta ${status}). Se guardó igual: mándate un SMS de prueba.` };
        }
        const st = str(json.status).toLowerCase();
        if (st === 'suspended' || st === 'closed') return { ...out, ok: false, error: `La cuenta de Twilio está ${st === 'closed' ? 'cerrada' : 'suspendida'}.` };
        const from = (creds.fields.from ?? '').trim();
        if (from === '') return { ...out, ok: false, error: 'Falta el remitente: un número de Twilio, un servicio de mensajería (MG…) o un nombre de remitente.' };
        out.label = str(json.friendly_name) || twilioSid(creds);
        if (str(json.type).toLowerCase() === 'trial') {
            out.warning = 'Es una cuenta de prueba de Twilio: sólo manda a números verificados en Twilio y antepone un texto de prueba.';
        }
        return out;
    },
    parseDeliveryReport(req) {
        const sid = pick(req, 'MessageSid') || pick(req, 'SmsSid');
        const st = (pick(req, 'MessageStatus') || pick(req, 'SmsStatus')).toLowerCase();
        if (sid === '') return [];
        const status: SmsStatus | null =
            st === 'delivered' || st === 'read' ? 'entregado' : st === 'sent' ? 'enviado' : st === 'undelivered' || st === 'failed' ? 'fallido' : null;
        if (!status) return [];
        const code = Number(pick(req, 'ErrorCode')) || null;
        return [{ providerIds: [sid], reference: null, status, error: status === 'fallido' ? twilioErrorText(code, '').text : null }];
    },
    verifyDeliveryReport(req, creds) {
        const given = req.headers['x-twilio-signature'] ?? '';
        if (given === '' || creds.secret === '') return false;
        const params = req.method.toUpperCase() === 'POST' ? obj(req.body) : {};
        const expected = twilioSignature(creds.secret, req.url, params);
        const a = Buffer.from(expected);
        const b = Buffer.from(given);
        return a.length === b.length && timingSafeEqual(a, b);
    },
};

// ── BulkGate ─────────────────────────────────────────────────────────────

function bulkgateError(json: Record<string, unknown> | null, status: number): { text: string; systemic: boolean; code: string } {
    const type = json ? str(json.type) : '';
    const said = json ? str(json.error) : '';
    if (status === 401 || type === 'unknown_identity') return { text: 'BulkGate no reconoce el Application ID o el token: revísalos en Ajustes → Integraciones.', systemic: true, code: type || '401' };
    if (/credit/i.test(type) || /credit/i.test(said)) return { text: 'La cuenta de BulkGate no tiene crédito: recárgala para seguir mandando.', systemic: true, code: type || 'credit' };
    if (type === 'invalid_phone_number') return { text: 'El número de destino no es válido.', systemic: false, code: type };
    if (/sender/i.test(type)) return { text: 'BulkGate no acepta ese remitente: revisa el «Remitente» de la conexión.', systemic: true, code: type };
    return { text: `BulkGate rechazó el SMS${said ? `: «${said}»` : ` (respuesta ${status})`}.`, systemic: false, code: type || String(status) };
}

/** `gSystem` (número de BulkGate), `gOwn` (número propio verificado) o `gText` (nombre). */
export function bulkgateSender(raw: string): { sender_id: string; sender_id_value?: string } {
    const s = raw.trim();
    if (s === '') return { sender_id: 'gSystem' };
    if (/^\+?\d{6,15}$/.test(s)) return { sender_id: 'gOwn', sender_id_value: s.replace(/\D/g, '') };
    return { sender_id: 'gText', sender_id_value: s.slice(0, 11) };
}

const bulkgate: SmsProvider = {
    key: 'sms_bulkgate',
    buildSend(input, creds, bases) {
        return {
            method: 'POST',
            url: `${trimBase(bases.bulkgate)}/api/1.0/simple/transactional`,
            headers: JSON_HEADERS,
            body: JSON.stringify({
                application_id: (creds.fields.application_id ?? '').trim(),
                application_token: creds.secret,
                // SUPUESTO: el número en formato internacional sin `+` no necesita `country`.
                number: digits(input.to),
                text: input.text,
                unicode: input.unicode,
                ...bulkgateSender(input.sender || creds.fields.sender || ''),
                tag: input.reference,
            }),
        };
    },
    parseSend(status, body) {
        const json = parseJson(body);
        const data = obj(json?.data);
        if (status >= 200 && status < 300 && str(data.sms_id) !== '') {
            const st = str(data.status).toLowerCase();
            if (st === 'error') {
                const e = bulkgateError(json, status);
                return { ok: false, error: e.text, systemic: e.systemic, code: e.code };
            }
            return { ok: true, providerId: str(data.sms_id), status: 'enviado', segments: null };
        }
        const e = bulkgateError(json, status);
        return { ok: false, error: e.text, systemic: e.systemic, code: e.code };
    },
    buildVerify(creds, bases) {
        return {
            method: 'POST',
            url: `${trimBase(bases.bulkgate)}/api/1.0/simple/info`,
            headers: JSON_HEADERS,
            body: JSON.stringify({ application_id: (creds.fields.application_id ?? '').trim(), application_token: creds.secret }),
        };
    },
    parseVerify(status, body) {
        const out: SmsVerifyOutcome = { ok: true, label: null, error: null, warning: null };
        const json = parseJson(body);
        const data = obj(json?.data);
        if (status >= 200 && status < 300 && 'credit' in data) {
            const credit = Number(data.credit);
            out.label = `Crédito: ${money(credit) ?? str(data.credit)}`;
            if (Number.isFinite(credit) && credit <= 0) out.warning = 'La cuenta de BulkGate no tiene crédito: los SMS no saldrán hasta que la recargues.';
            return out;
        }
        if (status === 401 || str(json?.type) === 'unknown_identity') return { ...out, ok: false, error: bulkgateError(json, 401).text };
        return { ...out, warning: `No pudimos consultar el crédito de BulkGate (respuesta ${status}). Se guardó igual: mándate un SMS de prueba.` };
    },
    parseDeliveryReport(req) {
        // GET con la query (un reporte) o, con «Bulk DLRs», POST con varios.
        const items: Array<Record<string, unknown>> = [];
        if (str(req.query.smsID) !== '' || str(req.query.status) !== '') items.push(req.query);
        const body = req.body;
        if (Array.isArray(body)) for (const x of body) items.push(obj(x));
        else {
            const b = obj(body);
            if (Array.isArray(b.data)) for (const x of b.data as unknown[]) items.push(obj(x));
            else if (str(b.smsID) !== '') items.push(b);
        }
        const out: SmsDeliveryUpdate[] = [];
        for (const it of items) {
            const id = str(it.smsID ?? it.sms_id);
            const code = Number(it.status);
            const status: SmsStatus | null = code === 1 || code === 13 ? 'entregado' : code === 2 ? 'enviado' : code === 3 ? 'fallido' : null;
            if (id === '' || !status) continue;
            // Un mensaje largo informa cada parte («…_1», «…_2»): se ata al envío.
            const base = id.replace(/_\d+$/, '');
            out.push({
                providerIds: base !== id ? [id, base] : [id],
                reference: null,
                status,
                error: status === 'fallido' ? 'No se entregó: el número no existe o no está disponible.' : null,
            });
        }
        return out;
    },
    verifyDeliveryReport() {
        // BulkGate no firma sus avisos: los protege el token de la URL y que
        // sólo se actualiza un SMS que mandamos nosotros por esa conexión.
        return true;
    },
};

// ── Infobip ──────────────────────────────────────────────────────────────

/** La URL base personal (`xxxxx.api.infobip.com`), con https si no trae esquema. */
export function infobipBase(raw: string): string {
    const v = trimBase(raw);
    if (v === '') return '';
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

const INFOBIP_REJECTED: Record<string, { text: string; systemic: boolean }> = {
    REJECTED_NOT_ENOUGH_CREDITS: { text: 'La cuenta de Infobip no tiene saldo: recárgala para seguir mandando.', systemic: true },
    REJECTED_SOURCE: { text: 'Infobip no acepta ese remitente: revisa el «Remitente» de la conexión.', systemic: true },
    REJECTED_SENDER: { text: 'Infobip no acepta ese remitente: revisa el «Remitente» de la conexión.', systemic: true },
    REJECTED_DESTINATION: { text: 'Infobip rechazó el número de destino.', systemic: false },
    REJECTED_INVALID_DESTINATION: { text: 'El número de destino no es válido.', systemic: false },
    REJECTED_PREFIX_MISSING: { text: 'Al número le falta el indicativo de país.', systemic: false },
    REJECTED_NETWORK: { text: 'Infobip no llega al operador de ese número.', systemic: false },
};

function infobipErrorText(json: Record<string, unknown> | null, status: number): { text: string; systemic: boolean; code: string } {
    if (status === 401) return { text: 'Infobip no reconoce la clave de API: revísala en Ajustes → Integraciones.', systemic: true, code: '401' };
    const svc = obj(obj(json?.requestError).serviceException);
    const said = str(svc.text) || str(json?.description) || str(json?.errorMessage);
    const code = str(svc.messageId) || str(json?.errorCode) || String(status);
    if (status === 403) return { text: 'La clave de API de Infobip no tiene permiso para mandar SMS.', systemic: true, code };
    return { text: `Infobip rechazó el SMS${said ? `: «${said}»` : ` (respuesta ${status})`}.`, systemic: false, code };
}

const infobip: SmsProvider = {
    key: 'sms_infobip',
    buildSend(input, creds) {
        const sender = (input.sender || creds.fields.sender || '').trim();
        const message: Record<string, unknown> = {
            destinations: [{ to: digits(input.to), messageId: input.reference }],
            content: { text: input.text },
        };
        if (sender !== '') message.sender = sender;
        if (input.callbackUrl) {
            message.webhooks = { delivery: { url: input.callbackUrl }, contentType: 'application/json', callbackData: input.reference };
        }
        return {
            method: 'POST',
            url: `${infobipBase(creds.fields.base_url ?? '')}/sms/3/messages`,
            headers: { ...JSON_HEADERS, authorization: `App ${creds.secret}` },
            body: JSON.stringify({ messages: [message] }),
        };
    },
    parseSend(status, body) {
        const json = parseJson(body);
        const first = obj(Array.isArray(json?.messages) ? (json!.messages as unknown[])[0] : null);
        if (status >= 200 && status < 300 && str(first.messageId) !== '') {
            const st = obj(first.status);
            const group = str(st.groupName).toUpperCase();
            if (group === 'REJECTED' || group === 'UNDELIVERABLE') {
                const name = str(st.name).toUpperCase();
                const known = INFOBIP_REJECTED[name];
                return {
                    ok: false,
                    error: known?.text ?? `Infobip rechazó el SMS: «${str(st.description) || name}».`,
                    systemic: known?.systemic ?? false,
                    code: name || group,
                };
            }
            const count = Number(obj(first.details).messageCount);
            return { ok: true, providerId: str(first.messageId), status: group === 'DELIVERED' ? 'entregado' : 'enviado', segments: Number.isFinite(count) && count > 0 ? count : null };
        }
        const e = infobipErrorText(json, status);
        return { ok: false, error: e.text, systemic: e.systemic, code: e.code };
    },
    buildVerify(creds) {
        // SUPUESTO: `GET /account/1/balance` → {balance, currency} (endpoint de cuenta de Infobip).
        return {
            method: 'GET',
            url: `${infobipBase(creds.fields.base_url ?? '')}/account/1/balance`,
            headers: { accept: 'application/json', authorization: `App ${creds.secret}` },
        };
    },
    parseVerify(status, body, creds) {
        const out: SmsVerifyOutcome = { ok: true, label: null, error: null, warning: null };
        if (infobipBase(creds.fields.base_url ?? '') === '') return { ...out, ok: false, error: 'Falta la URL base de Infobip (algo como xxxxx.api.infobip.com).' };
        if (status === 401) return { ...out, ok: false, error: infobipErrorText(null, 401).text };
        const json = parseJson(body);
        if (status === 200 && json && 'balance' in json) {
            out.label = `Saldo: ${money(json.balance) ?? str(json.balance)} ${str(json.currency)}`.trim();
            if (Number(json.balance) <= 0) out.warning = 'La cuenta de Infobip no tiene saldo: los SMS no saldrán hasta que la recargues.';
            return out;
        }
        // Una clave creada SÓLO para mandar SMS puede no tener permiso de ver el
        // saldo (la misma lección que WAS, v0.1.204): se guarda y se prueba.
        return {
            ...out,
            warning: `No pudimos consultar el saldo con esta clave (respuesta ${status}). Es normal si la clave sólo tiene permiso de envío: mándate un SMS de prueba para confirmar.`,
        };
    },
    parseDeliveryReport(req) {
        const body = obj(req.body);
        const results = Array.isArray(body.results) ? (body.results as unknown[]) : [];
        const out: SmsDeliveryUpdate[] = [];
        for (const raw of results) {
            const r = obj(raw);
            const id = str(r.messageId);
            const st = obj(r.status);
            const group = str(st.groupName).toUpperCase();
            const status: SmsStatus | null =
                group === 'DELIVERED' ? 'entregado' : group === 'PENDING' ? 'enviado' : group === 'UNDELIVERABLE' || group === 'EXPIRED' || group === 'REJECTED' ? 'fallido' : null;
            if (id === '' || !status) continue;
            const err = obj(r.error);
            const reason = str(st.description) || str(err.description) || str(st.name);
            out.push({
                providerIds: [id],
                reference: str(r.callbackData) || id,
                status,
                error: status === 'fallido' ? `Infobip no lo entregó: «${reason || group}».` : null,
            });
        }
        return out;
    },
    verifyDeliveryReport() {
        return true;
    },
};

// ── LabsMobile ───────────────────────────────────────────────────────────

function labsError(json: Record<string, unknown> | null, status: number): { text: string; systemic: boolean; code: string } {
    if (status === 401 || status === 403) return { text: 'LabsMobile no reconoce el usuario o el token de API: revísalos en Ajustes → Integraciones.', systemic: true, code: String(status) };
    const said = json ? str(json.message) : '';
    const code = json ? str(json.code) : String(status);
    if (/credit/i.test(said)) return { text: 'La cuenta de LabsMobile no tiene créditos: recárgala para seguir mandando.', systemic: true, code };
    return { text: `LabsMobile rechazó el SMS${said ? `: «${said}»` : ` (respuesta ${status})`}.`, systemic: false, code };
}

const labsmobile: SmsProvider = {
    key: 'sms_labsmobile',
    buildSend(input, creds, bases) {
        const sender = (input.sender || creds.fields.sender || '').trim();
        const body: Record<string, unknown> = {
            message: input.text,
            recipient: [{ msisdn: digits(input.to) }],
            subid: input.reference,
        };
        if (sender !== '') body.tpoa = sender;
        if (input.callbackUrl) body.ackurl = input.callbackUrl;
        if (input.unicode) body.ucs2 = '1';
        // SUPUESTO: `long` habilita los mensajes de más de una parte.
        if (input.segments > 1) body.long = '1';
        return {
            method: 'POST',
            url: `${trimBase(bases.labsmobile)}/json/send`,
            headers: { ...JSON_HEADERS, authorization: basic((creds.fields.username ?? '').trim(), creds.secret) },
            body: JSON.stringify(body),
        };
    },
    parseSend(status, body) {
        const json = parseJson(body);
        if (status >= 200 && status < 300 && json && str(json.code) === '0') {
            return { ok: true, providerId: str(json.subid) || null, status: 'enviado', segments: null };
        }
        const e = labsError(json, status);
        return { ok: false, error: e.text, systemic: e.systemic, code: e.code };
    },
    buildVerify(creds, bases) {
        return {
            method: 'GET',
            url: `${trimBase(bases.labsmobile)}/json/balance`,
            headers: { accept: 'application/json', authorization: basic((creds.fields.username ?? '').trim(), creds.secret) },
        };
    },
    parseVerify(status, body) {
        const out: SmsVerifyOutcome = { ok: true, label: null, error: null, warning: null };
        if (status === 401 || status === 403) return { ...out, ok: false, error: labsError(null, status).text };
        const json = parseJson(body);
        if (status === 200 && json && str(json.code) === '0') {
            // SUPUESTO: el saldo llega como `credits`.
            const credits = json.credits ?? json.credit;
            if (credits !== undefined) {
                out.label = `Créditos: ${money(credits) ?? str(credits)}`;
                if (Number(credits) <= 0) out.warning = 'La cuenta de LabsMobile no tiene créditos: los SMS no saldrán hasta que la recargues.';
            }
            return out;
        }
        if (json && str(json.code) !== '' && str(json.code) !== '0') return { ...out, ok: false, error: labsError(json, status).text };
        return { ...out, warning: `No pudimos consultar los créditos de LabsMobile (respuesta ${status}). Se guardó igual: mándate un SMS de prueba.` };
    },
    parseDeliveryReport(req) {
        // GET con acklevel, msisdn, status, desc, subid y timestamp.
        const subid = pick(req, 'subid');
        if (subid === '') return [];
        const level = pick(req, 'acklevel').toLowerCase();
        const st = pick(req, 'status').toLowerCase();
        const desc = pick(req, 'desc');
        // SUPUESTO: los valores de `status`. Positivos: ok / delivered / handset;
        // negativos: ko / error / rejected / failed / expired / undelivered.
        const bad = /^(ko|nok|error|rejected|failed|fail|expired|undelivered|not delivered)$/.test(st);
        const good = /^(ok|delivered|success|handset)$/.test(st);
        let status: SmsStatus | null = null;
        if (bad) status = 'fallido';
        else if (good) status = level === 'handset' ? 'entregado' : 'enviado';
        if (!status) return [];
        return [{ providerIds: [subid], reference: subid, status, error: status === 'fallido' ? `LabsMobile no lo entregó${desc ? `: «${desc}»` : '.'}` : null }];
    },
    verifyDeliveryReport() {
        return true;
    },
};

// ── Onurix ───────────────────────────────────────────────────────────────

const ONURIX_ERRORS: Record<number, { text: string; systemic: boolean }> = {
    1001: { text: 'Onurix no reconoce el Client ID o la Key: revísalos en Ajustes → Integraciones.', systemic: true },
    1002: { text: 'Onurix no reconoce el Client ID o la Key: revísalos en Ajustes → Integraciones.', systemic: true },
    1003: { text: 'Onurix no reconoce el Client ID o la Key: revísalos en Ajustes → Integraciones.', systemic: true },
    1004: { text: 'Onurix no permite la IP de este servidor: autorízala en portal.onurix.com → Seguridad → Datos de integración API.', systemic: true },
    1005: { text: 'Onurix todavía no aprobó la IP de este servidor: autorízala en portal.onurix.com → Seguridad → Datos de integración API.', systemic: true },
    1007: { text: 'El número de destino no es válido.', systemic: false },
    1008: { text: 'La cuenta de Onurix no tiene créditos: recárgala para seguir mandando.', systemic: true },
    1010: { text: 'Ese número está bloqueado en Onurix.', systemic: false },
    1014: { text: 'La cuenta de Onurix está deshabilitada.', systemic: true },
    1017: { text: 'La cuenta de Onurix todavía no está habilitada (falta documentación).', systemic: true },
    1048: { text: 'La cuenta de Onurix está inactiva por control antifraude.', systemic: true },
    1061: { text: 'La cuenta de Onurix no tiene créditos: recárgala para seguir mandando.', systemic: true },
    1077: { text: 'Falta la firma SMS que exige la CRC: configúrala en tu cuenta de Onurix.', systemic: true },
    1114: { text: 'El mensaje es demasiado largo para Onurix (máximo 960 caracteres).', systemic: false },
    1146: { text: 'Onurix está recibiendo demasiadas peticiones: se reintenta más tarde.', systemic: false },
};

function onurixError(json: Record<string, unknown> | null, status: number): { text: string; systemic: boolean; code: string } {
    const code = json ? Number(json.error) : NaN;
    if (Number.isFinite(code) && ONURIX_ERRORS[code]) return { ...ONURIX_ERRORS[code]!, code: String(code) };
    const said = json ? str(json.msg) : '';
    return { text: `Onurix rechazó el SMS${said ? `: «${said}»` : ` (respuesta ${status})`}.`, systemic: false, code: Number.isFinite(code) ? String(code) : String(status) };
}

/**
 * SUPUESTO: los valores de `state` de `messages-state` (la documentación no los
 * lista). Se reconocen por su significado.
 */
export function onurixStateToStatus(state: string): SmsStatus | null {
    const s = state.trim().toLowerCase();
    if (s === '') return null;
    if (/no entreg|undeliver|fall|error|rechaz|fail|expir|bloque|invalid/.test(s)) return 'fallido';
    if (/entreg|deliver|recib/.test(s)) return 'entregado';
    if (/envi|sent|proces|cola|queue|pend/.test(s)) return 'enviado';
    return null;
}

const onurix: SmsProvider = {
    key: 'sms_onurix',
    buildSend(input, creds, bases) {
        return {
            method: 'POST',
            url: `${trimBase(bases.onurix)}/api/v1/sms/send`,
            headers: FORM_HEADERS,
            body: form([
                ['client', (creds.fields.client_id ?? '').trim()],
                ['key', creds.secret],
                ['phone', digits(input.to)],
                ['sms', input.text],
            ]),
        };
    },
    parseSend(status, body) {
        const json = parseJson(body);
        if (status >= 200 && status < 300 && json && json.error === undefined && (json.id !== undefined || json.data !== undefined)) {
            const data = Array.isArray(json.data) ? obj((json.data as unknown[])[0]) : obj(json.data);
            // SUPUESTO: el id de arriba es el del envío que acepta `messages-state`; si no viene, el del mensaje.
            const id = str(json.id) || str(data.id);
            const credits = Number(data.credits);
            return { ok: true, providerId: id || null, status: 'enviado', segments: Number.isFinite(credits) && credits > 0 ? credits : null };
        }
        const e = onurixError(json, status);
        return { ok: false, error: e.text, systemic: e.systemic, code: e.code };
    },
    buildVerify(creds, bases) {
        return {
            method: 'GET',
            url: `${trimBase(bases.onurix)}/api/v1/balance?${form([
                ['client', (creds.fields.client_id ?? '').trim()],
                ['key', creds.secret],
            ])}`,
            headers: { accept: 'application/json' },
        };
    },
    parseVerify(status, body) {
        const out: SmsVerifyOutcome = { ok: true, label: null, error: null, warning: null };
        const json = parseJson(body);
        if (json && json.error !== undefined) return { ...out, ok: false, error: onurixError(json, status).text };
        if (status >= 200 && status < 300 && json) {
            const balance = json.balance ?? json.credits ?? json.saldo;
            if (balance !== undefined) out.label = `Saldo: ${money(balance) ?? str(balance)}`;
            return out;
        }
        return { ...out, warning: `No pudimos consultar el saldo de Onurix (respuesta ${status}). Se guardó igual: mándate un SMS de prueba.` };
    },
    parseDeliveryReport() {
        // Onurix no avisa los estados de SMS: se consultan (`buildStatusPoll`).
        return [];
    },
    verifyDeliveryReport() {
        return false;
    },
    buildStatusPoll(providerId, creds, bases) {
        return {
            method: 'GET',
            url: `${trimBase(bases.onurix)}/api/v1/messages-state?${form([
                ['client', (creds.fields.client_id ?? '').trim()],
                ['key', creds.secret],
                ['id', providerId],
            ])}`,
            headers: { accept: 'application/json' },
        };
    },
    parseStatusPoll(status, body) {
        const json = parseJson(body);
        if (status < 200 || status >= 300 || !json || json.error !== undefined) return null;
        const row = Array.isArray(json.data) ? obj((json.data as unknown[])[0]) : json;
        const state = str(row.state);
        const st = onurixStateToStatus(state);
        if (!st) return null;
        return { providerIds: [str(row.id) || str(row.dispatch_id)].filter(Boolean), reference: null, status: st, error: st === 'fallido' ? `Onurix no lo entregó: «${state}».` : null };
    },
};

export const SMS_PROVIDERS: Record<SmsProviderKey, SmsProvider> = {
    sms_twilio: twilio,
    sms_bulkgate: bulkgate,
    sms_infobip: infobip,
    sms_labsmobile: labsmobile,
    sms_onurix: onurix,
};

/** Los secretos que hay que tapar en lo que se muestra de una petición. */
export function smsSecretsOf(creds: SmsCreds): string[] {
    return [creds.secret].filter((s) => s.length >= 4);
}

/** Las bases de las APIs: las reales en producción, las de prueba si el entorno las da. */
export function smsBases(env: {
    NODE_ENV: string;
    SMS_TWILIO_API_URL: string;
    SMS_BULKGATE_API_URL: string;
    SMS_LABSMOBILE_API_URL: string;
    SMS_ONURIX_API_URL: string;
}): SmsBases {
    const choose = (override: string, real: string): string => (env.NODE_ENV === 'production' || override.trim() === '' ? real : override.trim());
    return {
        twilio: choose(env.SMS_TWILIO_API_URL, DEFAULT_SMS_BASES.twilio),
        bulkgate: choose(env.SMS_BULKGATE_API_URL, DEFAULT_SMS_BASES.bulkgate),
        labsmobile: choose(env.SMS_LABSMOBILE_API_URL, DEFAULT_SMS_BASES.labsmobile),
        onurix: choose(env.SMS_ONURIX_API_URL, DEFAULT_SMS_BASES.onurix),
    };
}

/** El texto del SMS de prueba al conectar (sin el nombre del producto: lo ve el cliente de la empresa). */
export const SMS_TEST_MESSAGE = 'Prueba de conexión: si te llegó este SMS, la integración quedó lista.';
