import { createHmac, timingSafeEqual } from 'node:crypto';
import { WA_WEB_ACCOUNT_STATUS_LABEL, WA_WEB_DEFAULT_SERVER, WA_WEB_HOOK_EVENTS, WA_WEB_KEY_ABILITIES } from '@imagina-base/shared';
import type { IntegrationCreds, IntegrationRequest } from '../connectors/integration-calls';
import type { InboundMessage, StatusUpdate } from './whatsapp-webhook';

/**
 * v0.1.389 — La versión nueva de Imagina WAS (API pública v1 de Zender,
 * `https://whats.imagina.cloud/api/v1`). PURO: arma los pedidos, lee las
 * respuestas, traduce los errores y verifica/lee los avisos. El servicio de
 * WhatsApp y el «Probar ahora» usan estas MISMAS funciones, así lo que se
 * prueba es lo que sale.
 *
 * Lo que dice la documentación (y se confirmó contra el servidor real):
 * - La clave va como `Authorization: Bearer <clave>` con `Accept: application/json`.
 * - Enviar responde 202 con el mensaje (`data.id`): «en cola», no entregado.
 * - Los errores vienen siempre como `{ error: { code, message, details } }`.
 * - Cada mensaje dice de qué número es: `connection: { type: 'wa', id }`, el
 *   mismo `id` de la cuenta. Los avisos son de TODO el espacio de trabajo, así
 *   que se filtran por ese número.
 * - Los avisos se firman: `X-Webhook-Signature: t=<unix>,v1=<hex>` =
 *   HMAC-SHA256(secreto, `<t>.<cuerpo crudo>`). El secreto lo da Imagina WAS
 *   UNA vez, al crear el aviso.
 */

export interface WaWebCreds {
    server: string;
    key: string;
    /** El id del número elegido (`wa_account_id`). */
    accountId: number | null;
    /** El secreto de los avisos (lo devuelve Imagina WAS al registrarlos). */
    hookSecret: string;
}

export function waWebCreds(creds: IntegrationCreds): WaWebCreds {
    const raw = (creds.fields.server ?? '').trim() || WA_WEB_DEFAULT_SERVER;
    const account = Number((creds.fields.account ?? '').trim());
    return {
        server: raw.replace(/\/+$/, '').replace(/\/api\/v1$/i, ''),
        key: creds.secret.trim(),
        accountId: Number.isInteger(account) && account > 0 ? account : null,
        hookSecret: creds.signingSecret ?? '',
    };
}

function headers(c: WaWebCreds, json: boolean): Record<string, string> {
    return {
        authorization: `Bearer ${c.key}`,
        accept: 'application/json',
        ...(json ? { 'content-type': 'application/json' } : {}),
    };
}

const api = (c: WaWebCreds, path: string): string => `${c.server}/api/v1${path}`;

// ── Pedidos ─────────────────────────────────────────────────────────────

export function waWebMeRequest(c: WaWebCreds): IntegrationRequest {
    return { url: api(c, '/me'), method: 'GET', headers: headers(c, false) };
}

export function waWebAccountsRequest(c: WaWebCreds): IntegrationRequest {
    return { url: api(c, '/whatsapp/accounts?limit=100'), method: 'GET', headers: headers(c, false) };
}

export function waWebAccountRequest(c: WaWebCreds, accountId: number): IntegrationRequest {
    return { url: api(c, `/whatsapp/accounts/${accountId}`), method: 'GET', headers: headers(c, false) };
}

export type WaWebPayload =
    | { kind: 'text'; to: string; text: string }
    | { kind: 'media'; to: string; url: string; caption: string };

/** El cuerpo del envío (`to` con el `+`; el número de la empresa por su id). */
export function waWebSendBody(c: WaWebCreds, p: WaWebPayload, reference?: string): Record<string, unknown> {
    const body: Record<string, unknown> = { to: p.to.startsWith('+') ? p.to : `+${p.to}`, type: p.kind };
    if (c.accountId !== null) body.wa_account_id = c.accountId;
    if (p.kind === 'text') body.body = p.text;
    else {
        body.media_url = p.url;
        if (p.caption.trim() !== '') body.body = p.caption;
    }
    if (reference && reference.trim() !== '') body.reference = reference.trim().slice(0, 191);
    return body;
}

/**
 * `Idempotency-Key`: si un reintento repite el MISMO envío dentro de 24 h,
 * Imagina WAS devuelve la respuesta original en vez de mandar dos veces.
 */
export function waWebSendRequest(c: WaWebCreds, p: WaWebPayload, opts: { reference?: string; idempotencyKey?: string } = {}): IntegrationRequest {
    return {
        url: api(c, '/messages/whatsapp'),
        method: 'POST',
        headers: { ...headers(c, true), ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}) },
        body: JSON.stringify(waWebSendBody(c, p, opts.reference)),
    };
}

export function waWebCreateHookRequest(c: WaWebCreds, url: string, name: string): IntegrationRequest {
    return {
        url: api(c, '/webhooks'),
        method: 'POST',
        headers: headers(c, true),
        body: JSON.stringify({ name: name.slice(0, 128), url, events: [...WA_WEB_HOOK_EVENTS], is_active: true }),
    };
}

export function waWebHookRequest(c: WaWebCreds, hookId: number): IntegrationRequest {
    return { url: api(c, `/webhooks/${hookId}`), method: 'GET', headers: headers(c, false) };
}

export function waWebDeleteHookRequest(c: WaWebCreds, hookId: number): IntegrationRequest {
    return { url: api(c, `/webhooks/${hookId}`), method: 'DELETE', headers: headers(c, false) };
}

// ── Respuestas ──────────────────────────────────────────────────────────

function parseJson(body: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function rec(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function strOrNull(v: unknown): string | null {
    const s = str(v).trim();
    return s === '' ? null : s;
}

export interface WaWebError {
    status: number;
    code: string;
    message: string;
    details: Record<string, unknown>;
}

/** El error de una respuesta (null si salió bien). */
export function parseWaWebError(status: number, body: string): WaWebError | null {
    if (status >= 200 && status < 300) return null;
    const err = rec(rec(parseJson(body)).error);
    return {
        status,
        code: str(err.code) || (status >= 500 ? 'server_error' : `http_${status}`),
        message: str(err.message),
        details: rec(err.details),
    };
}

const ABILITY_LABEL: Record<string, string> = {
    'account.view': 'account.view (ver la cuenta)',
    'wa.accounts.view': 'wa.accounts.view (ver los números)',
    'wa.send': 'wa.send (enviar)',
    'wa.read': 'wa.read (leer los mensajes)',
    'webhooks.manage': 'webhooks.manage (avisos)',
};

/**
 * El motivo en palabras. Los códigos son los de la documentación de la API
 * v1 (`x-codes`); lo que no está aquí se muestra con lo que dijo el servidor.
 */
export function waWebErrorText(err: WaWebError): string {
    const d = err.details;
    const said = err.message.trim() !== '' ? ` Dijo: «${err.message.trim().slice(0, 240)}».` : '';
    switch (err.code) {
        case 'unauthenticated':
            return 'La clave de API ya no sirve (la borraron, venció o está mal copiada): crea otra en tu panel de WhatsApp (API Keys) y actualízala en Integraciones.';
        case 'missing_ability': {
            const ab = str(d.ability);
            return `La clave no tiene el permiso ${ab ? `«${ABILITY_LABEL[ab] ?? ab}»` : 'que hace falta'}: edítala en tu panel de WhatsApp (API Keys) y márcalo.`;
        }
        case 'feature_not_in_plan': {
            const f = str(d.feature);
            const what = f === 'api' ? 'el acceso por API' : f === 'wa' ? 'WhatsApp' : f !== '' ? `«${f}»` : 'esta función';
            return `Tu plan de WhatsApp no incluye ${what}.`;
        }
        case 'workspace_pending_review':
            return 'Tu espacio de trabajo de WhatsApp está en revisión: los envíos están en pausa hasta que el administrador lo apruebe.';
        case 'trial_destination_not_allowed':
            return 'Tu cuenta de WhatsApp está en prueba y por ahora sólo puede enviar a números de su propio país.';
        case 'content_blocked':
            return 'El servidor de WhatsApp bloqueó el texto del mensaje por su política de envíos.';
        case 'sending_blocked':
            return 'Los envíos de WhatsApp están apagados para tu espacio de trabajo.';
        case 'no_wa_account':
            return 'No hay un número de WhatsApp conectado para enviar: vincúlalo en tu panel de WhatsApp.';
        case 'account_disconnected':
            return 'El número de WhatsApp está desconectado: vuelve a vincularlo en tu panel de WhatsApp (Re-Pair) escaneando el código QR.';
        case 'account_suspended':
            return 'El número de WhatsApp está suspendido.';
        case 'not_on_whatsapp':
            return 'Ese número no tiene WhatsApp.';
        case 'insufficient_credits':
            return 'No hay créditos suficientes en tu cuenta de WhatsApp.';
        case 'media_too_large':
        case 'file_too_large':
            return 'El archivo pasa el tamaño que se puede enviar (50 MB).';
        case 'media_type_unsupported':
        case 'media_not_supported':
        case 'media_type_mismatch':
            return 'Ese tipo de archivo no se puede enviar por WhatsApp. Sirven JPG, PNG, GIF, WebP, MP4, MP3, AAC, OGG y PDF.';
        case 'attachment_fetch_failed':
        case 'media_missing':
        case 'attachment_missing':
            return `El servidor de WhatsApp no pudo descargar el archivo: revisa que el enlace sea público y empiece con https://.${said}`;
        case 'rate_limited': {
            const retry = Number(d.retry_after);
            const wait = Number.isFinite(retry) && retry > 0 ? ` Se puede volver a enviar en ${Math.ceil(retry / 60) > 1 ? `${Math.ceil(retry / 60)} minutos` : `${Math.ceil(retry)} segundos`}.` : '';
            if (str(d.reason) === 'wa_warmup_cap_reached') {
                return 'El número está en calentamiento y ya llegó al tope de mensajes de hoy: los envíos vuelven mañana. Es una protección para que WhatsApp no lo bloquee.';
            }
            if (str(d.limit) === 'api_key_daily_sends') return `La clave llegó a su tope diario de envíos (lo pusiste en API Keys).${wait}`;
            if (str(d.scope) === 'sending_limit') return `Tu espacio de trabajo llegó a su límite de envíos.${wait}`;
            return `Demasiados pedidos seguidos al servidor de WhatsApp.${wait || ' Prueba de nuevo en un momento.'}`;
        }
        case 'validation_failed': {
            const fields = rec(d.fields);
            const first = Object.entries(fields)[0];
            if (first) {
                const [name, msgs] = first;
                const text = Array.isArray(msgs) ? msgs.map(str).filter(Boolean).join(' ') : str(msgs);
                if (name === 'to' || name === 'phone') return `El número de destino no es válido.${text ? ` (${text})` : ''}`;
                return `El servidor de WhatsApp rechazó «${name}»: ${text || 'no es válido'}.`;
            }
            return `El servidor de WhatsApp rechazó los datos del envío.${said}`;
        }
        case 'not_found':
            return 'El servidor de WhatsApp no encontró lo pedido (¿el número se eliminó del panel?).';
        default:
            if (err.status >= 500) return 'El servidor de WhatsApp tuvo un problema. Prueba de nuevo en un momento.';
            if (err.status === 404) return 'No encontramos el servidor de WhatsApp en esa dirección: revisa «Servidor» en las opciones avanzadas.';
            return `El servidor de WhatsApp rechazó el pedido (${err.code}).${said}`;
    }
}

/** Errores de la CONEXIÓN (no del destinatario): abren un problema hasta que vuelva a andar. */
export function isSystemicWaWebError(err: WaWebError): boolean {
    return [
        'unauthenticated',
        'missing_ability',
        'feature_not_in_plan',
        'workspace_pending_review',
        'sending_blocked',
        'no_wa_account',
        'account_disconnected',
        'account_suspended',
        'insufficient_credits',
    ].includes(err.code);
}

/** El envío aceptado (202): el id del mensaje para atarle sus estados. */
export function parseWaWebSend(status: number, body: string): { ok: true; id: string } | { ok: false; error: WaWebError } {
    const err = parseWaWebError(status, body);
    if (err) return { ok: false, error: err };
    const id = str(rec(rec(parseJson(body)).data).id);
    if (id === '') {
        return { ok: false, error: { status, code: 'unexpected_response', message: 'La respuesta no trae el id del mensaje.', details: {} } };
    }
    return { ok: true, id };
}

export interface WaWebAccount {
    id: number;
    phone: string | null;
    name: string | null;
    status: string;
    statusReason: string | null;
    bannedUntil: string | null;
    enabled: boolean;
}

function toAccount(a: Record<string, unknown>): WaWebAccount | null {
    const id = Number(a.id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return {
        id,
        phone: strOrNull(a.phone),
        name: strOrNull(a.display_name) ?? strOrNull(a.label),
        status: str(a.status) || 'unknown',
        statusReason: strOrNull(a.status_reason),
        bannedUntil: strOrNull(a.banned_until),
        enabled: a.is_enabled !== false,
    };
}

export function parseWaWebAccounts(body: string): WaWebAccount[] {
    const data = rec(parseJson(body)).data;
    if (!Array.isArray(data)) return [];
    return data.map((a) => toAccount(rec(a))).filter((a): a is WaWebAccount => a !== null);
}

export function parseWaWebAccount(body: string): WaWebAccount | null {
    return toAccount(rec(rec(parseJson(body)).data));
}

export function waWebAccountStatusLabel(a: Pick<WaWebAccount, 'status' | 'enabled'>): string {
    if (!a.enabled) return 'Apagado en el panel';
    return WA_WEB_ACCOUNT_STATUS_LABEL[a.status] ?? a.status;
}

/** Cómo se ve un número en la lista para elegir: «+57 317 833 9119 · Augusto · Conectado». */
export function waWebAccountOption(a: WaWebAccount): { value: string; label: string } {
    const parts = [a.phone ?? `#${a.id}`, a.name, waWebAccountStatusLabel(a)].filter((x): x is string => typeof x === 'string' && x !== '');
    return { value: String(a.id), label: parts.join(' · ') };
}

export interface WaWebMe {
    workspace: string | null;
    abilities: string[];
    features: Record<string, unknown>;
}

export function parseWaWebMe(body: string): WaWebMe {
    const data = rec(rec(parseJson(body)).data);
    const token = rec(data.token);
    return {
        workspace: strOrNull(rec(data.workspace).name),
        abilities: Array.isArray(token.abilities) ? token.abilities.map(str).filter(Boolean) : [],
        features: rec(rec(data.plan).features),
    };
}

/** Los permisos recomendados que le faltan a la clave. */
export function missingWaWebAbilities(abilities: readonly string[]): string[] {
    return WA_WEB_KEY_ABILITIES.filter((a) => !abilities.includes(a));
}

export function waWebAbilityLabel(ability: string): string {
    return ABILITY_LABEL[ability] ?? ability;
}

/** El aviso recién creado: su id y el secreto (Imagina WAS lo muestra UNA vez). */
export function parseWaWebHookCreated(body: string): { id: number; secret: string } | null {
    const data = rec(rec(parseJson(body)).data);
    const raw = Object.keys(data).length > 0 ? data : rec(parseJson(body));
    const id = Number(raw.id);
    const secret = str(raw.secret);
    return Number.isInteger(id) && id > 0 && secret !== '' ? { id, secret } : null;
}

/** ¿El aviso sigue activo? (null = no se pudo saber). */
export function parseWaWebHookActive(status: number, body: string): boolean | null {
    if (status === 404) return false;
    if (status < 200 || status >= 300) return null;
    const data = rec(rec(parseJson(body)).data);
    if (typeof data.is_active === 'boolean') return data.is_active;
    if (typeof data.active === 'boolean') return data.active;
    return true;
}

// ── Avisos ──────────────────────────────────────────────────────────────

/** Tolerancia de la hora de la firma: un aviso firmado hace más de esto se rechaza. */
export const WA_WEB_SIGNATURE_TOLERANCE_S = 15 * 60;

/**
 * `X-Webhook-Signature: t=<unix>,v1=<hex>`. Se firma `<t>.<cuerpo crudo>`
 * (los bytes recibidos: re-serializar el JSON cambiaría la firma). Si viene
 * `X-Webhook-Timestamp`, tiene que coincidir con el `t` de la firma.
 */
export function verifyWaWebSignature(
    secret: string,
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
    nowS: number = Math.floor(Date.now() / 1000),
): boolean {
    if (!signature || secret === '') return false;
    const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/i.exec(signature.trim());
    if (!m) return false;
    const t = m[1]!;
    if (timestamp !== undefined && timestamp.trim() !== '' && timestamp.trim() !== t) return false;
    if (Math.abs(nowS - Number(t)) > WA_WEB_SIGNATURE_TOLERANCE_S) return false;
    const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
    const given = Buffer.from(m[2]!, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Firma un cuerpo como Imagina WAS (para los tests y el probador local). */
export function signWaWebBody(secret: string, rawBody: string, nowS: number = Math.floor(Date.now() / 1000)): string {
    return `t=${nowS},v1=${createHmac('sha256', secret).update(`${nowS}.${rawBody}`, 'utf8').digest('hex')}`;
}

const MEDIA_LABEL: Record<string, string> = {
    image: 'Imagen',
    video: 'Video',
    audio: 'Audio',
    voice: 'Nota de voz',
    ptt: 'Nota de voz',
    document: 'Documento',
    sticker: 'Sticker',
    location: 'Ubicación',
    contact: 'Contacto',
};

/** Lo que queda como «último mensaje»: el texto, o el tipo y su pie de foto. Los adjuntos no se descargan. */
function inboundText(msg: Record<string, unknown>): string {
    const body = str(msg.body).trim();
    const type = str(msg.type).toLowerCase();
    if (type === '' || type === 'text' || type === 'chat') return body;
    const label = MEDIA_LABEL[type] ?? (str(msg.kind) === 'media' ? 'Archivo' : '');
    if (label === '') return body;
    const att = Array.isArray(msg.attachments) ? rec(msg.attachments[0]) : {};
    const name = type === 'document' ? str(att.name).trim() : '';
    const extra = body !== '' ? body : name;
    return extra !== '' ? `[${label}] ${extra}` : `[${label}]`;
}

function whenOf(...values: unknown[]): Date {
    for (const v of values) {
        const s = str(v);
        if (s === '') continue;
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
}

const STATUS_DETAIL: Record<string, string> = {
    canceled: 'Se canceló antes de salir.',
    expired: 'Venció antes de poder enviarse.',
    unsubscribed: 'El contacto se dio de baja de tus mensajes en WAS.',
    insufficient_credits: 'No había créditos suficientes en tu cuenta de WhatsApp.',
    no_whatsapp: 'Ese número no tiene WhatsApp.',
    invalid_number: 'El número no es válido.',
    rate_limited: 'Se frenó por el límite de envíos.',
    channel_unavailable: 'El número de la empresa no estaba disponible (¿desconectado?).',
    whatsapp_rejected: 'WhatsApp rechazó el mensaje.',
    invalid_recipient: 'El destinatario no es válido.',
};

/** Fallas de la CONEXIÓN informadas en un aviso (no del destinatario). */
export function isSystemicWaWebFailure(reason: string | null): boolean {
    return reason === 'channel_unavailable' || reason === 'insufficient_credits';
}

export interface ParsedWaWebHook {
    event: string;
    /** Id de la entrega (el mismo en cada reintento). */
    deliveryId: string;
    /** El número de la empresa (cuenta) del mensaje, si el aviso lo trae. */
    accountId: number | null;
    message: InboundMessage | null;
    status: (StatusUpdate & { failureReason: string | null }) | null;
}

/**
 * Un aviso de Imagina WAS. `wa.message.received` → un mensaje que escribió un
 * contacto; `wa.message.sent|delivered|read|failed|canceled` → el estado de
 * un envío. El resto (y los grupos) se ignora.
 */
export function parseWaWebHook(body: unknown, headerEvent?: string): ParsedWaWebHook {
    const root = rec(body);
    const event = str(root.event) || str(headerEvent);
    const msg = rec(root.payload);
    const conn = rec(msg.connection);
    const accountNum = Number(conn.id);
    const accountId = str(conn.type) !== '' && str(conn.type) !== 'wa' ? null : Number.isInteger(accountNum) && accountNum > 0 ? accountNum : null;
    const out: ParsedWaWebHook = { event, deliveryId: str(root.id), accountId, message: null, status: null };
    if (!event.startsWith('wa.message.') || str(msg.channel) === 'waba' || str(msg.channel) === 'sms') return out;
    const id = str(msg.id);
    if (id === '') return out;
    const account = accountId !== null ? String(accountId) : '';
    if (event === 'wa.message.received') {
        const from = str(msg.from) || str(msg.sender);
        // Los grupos (`…@g.us`) no son un contacto de una lista.
        if (from === '' || from.includes('@')) return out;
        const digits = from.replace(/\D/g, '');
        if (digits === '') return out;
        out.message = {
            phoneNumberId: account,
            waId: digits,
            profileName: null,
            id: `web-${id}`,
            at: whenOf(msg.created_at, root.sent_at),
            type: str(msg.type) || 'text',
            text: inboundText(msg),
        };
        return out;
    }
    const status = event.slice('wa.message.'.length);
    const reason = strOrNull(msg.failure_reason);
    const errorReason = strOrNull(msg.error_reason);
    const detail = reason ? [STATUS_DETAIL[reason], errorReason].filter(Boolean).join(' ') : (errorReason ?? '');
    out.status = {
        phoneNumberId: account,
        id,
        status,
        at: whenOf(msg.read_at, msg.delivered_at, msg.sent_at, msg.created_at, root.sent_at),
        recipientId: str(msg.to).replace(/\D/g, ''),
        errors:
            status === 'failed' || status === 'canceled'
                ? [{ code: null, title: reason ?? status, message: detail || 'No se pudo entregar el mensaje.', details: errorReason }]
                : [],
        failureReason: reason,
    };
    return out;
}
